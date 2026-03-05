import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { chatSession, chatMessage, entity, field, fieldMapping, workspace } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod/v4";
import { resolveProvider } from "@/lib/generation/provider-resolver";
import type { BigQueryConfig } from "@/types/workspace";
import type { ToolDefinition, ToolCall } from "@/lib/llm/provider";
import {
  getBigQueryToolDefinition,
  executeBigQueryTool,
  formatToolResultForLLM,
  formatToolResultForClient,
} from "@/lib/bigquery/tool-executor";
import {
  getSourceSchemaToolDefinition,
  executeSourceSchemaSearch,
  formatSourceSchemaForLLM,
  formatSourceSchemaForClient,
  getReferenceDocsToolDefinition,
  executeReferenceDocRetrieval,
  formatReferenceDocsForLLM,
  formatReferenceDocsForClient,
  getSiblingMappingsToolDefinition,
  executeSiblingMappingLookup,
  formatSiblingMappingsForLLM,
  formatSiblingMappingsForClient,
  getMappingExamplesToolDefinition,
  executeMappingExampleSearch,
  formatMappingExamplesForLLM,
  formatMappingExamplesForClient,
  type SourceSchemaInput,
  type ReferenceDocsInput,
  type SiblingMappingsInput,
  type MappingExamplesInput,
} from "@/lib/rag";
import { isBaselineReady, getBaselineData } from "@/lib/bigquery/prefetch-cache";
import { injectBaselineData } from "@/lib/generation/chat-prompt-builder";
import { extractAndPersistContextGaps } from "@/lib/generation/context-gap-extractor";

const sendMessageSchema = z.object({
  content: z.string().min(1),
  voiceInput: z.boolean().optional(),
  kickoff: z.boolean().optional(),
});

const MAX_TOOL_ROUNDS = 8;
const MAX_TOOL_RESULT_TOKENS = 32_000; // rough char-based budget

function matchName(a: string, b: string): boolean {
  return a.toLowerCase().replace(/[_\s-]/g, "") === b.toLowerCase().replace(/[_\s-]/g, "");
}

function resolveMappingUpdateIds(
  update: Record<string, unknown>,
  sourceEntities: { id: string; name: string }[],
  sourceFields: { id: string; name: string; entityId: string }[]
): Record<string, unknown> {
  const enriched = { ...update };
  const entityName = update.sourceEntityName as string | undefined;
  const fieldName = update.sourceFieldName as string | undefined;

  let resolvedEntityId: string | null = null;
  if (entityName) {
    const match = sourceEntities.find((e) => matchName(e.name, entityName));
    if (match) {
      resolvedEntityId = match.id;
      enriched.sourceEntityId = match.id;
    }
  }
  if (fieldName) {
    const candidates = resolvedEntityId
      ? sourceFields.filter((f) => f.entityId === resolvedEntityId)
      : sourceFields;
    const match = candidates.find((f) => matchName(f.name, fieldName));
    if (match) {
      enriched.sourceFieldId = match.id;
      if (!resolvedEntityId) enriched.sourceEntityId = match.entityId;
    }
  }
  return enriched;
}

export const POST = withAuth(
  async (req, ctx, { userId, workspaceId }) => {
    const params = await ctx.params;
    const sessionId = params.sessionId;

    const body = await req.json();
    const parsed = sendMessageSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.message },
        { status: 400 }
      );
    }

    // Verify session exists and belongs to workspace
    const session = (await db
      .select()
      .from(chatSession)
      .where(
        and(
          eq(chatSession.id, sessionId),
          eq(chatSession.workspaceId, workspaceId)
        )
      ))[0];

    if (!session) {
      return NextResponse.json(
        { error: "Chat session not found" },
        { status: 404 }
      );
    }

    const now = new Date().toISOString();

    // Save user message
    const userMeta: Record<string, unknown> = {};
    if (parsed.data.voiceInput) userMeta.voiceInput = true;
    if (parsed.data.kickoff) userMeta.kickoff = true;

    await db.insert(chatMessage)
      .values({
        sessionId,
        role: "user",
        content: parsed.data.content,
        metadata: Object.keys(userMeta).length > 0 ? userMeta : null,
        createdAt: now,
      });

    // Load full message history
    const allMessages = await db
      .select()
      .from(chatMessage)
      .where(eq(chatMessage.sessionId, sessionId))
      .orderBy(chatMessage.createdAt)
      ;

    // Separate system message from conversation
    let systemMsg = allMessages.find((m) => m.role === "system");
    const conversationMessages = allMessages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    // Inject pre-generated AI review as prior assistant context on first user message
    const isFirstUserMessage = conversationMessages.filter((m) => m.role === "user").length === 1;
    if (isFirstUserMessage && session.fieldMappingId) {
      const [mappingWithReview] = await db.select({ aiReview: fieldMapping.aiReview })
        .from(fieldMapping)
        .where(eq(fieldMapping.id, session.fieldMappingId))
        .limit(1);
      const aiReview = mappingWithReview?.aiReview as { reviewText?: string; proposedUpdate?: Record<string, unknown> } | null;
      if (aiReview?.reviewText) {
        const reviewContext = aiReview.proposedUpdate
          ? `${aiReview.reviewText}\n\n\`\`\`mapping-update\n${JSON.stringify(aiReview.proposedUpdate, null, 2)}\n\`\`\``
          : aiReview.reviewText;
        // Prepend as assistant message before the user's first message
        conversationMessages.splice(conversationMessages.length - 1, 0, {
          role: "assistant",
          content: `[Pre-generated review]\n\n${reviewContext}`,
        });
      }
    }

    // On kickoff: inject pre-fetched BQ baseline data into system message
    if (parsed.data.kickoff && systemMsg && session.fieldMappingId) {
      try {
        // Resolve source entity/field names from the mapping
        const [mapping] = await db.select().from(fieldMapping)
          .where(eq(fieldMapping.id, session.fieldMappingId)).limit(1);

        let sourceEntityName: string | undefined;
        let sourceFieldName: string | undefined;
        if (mapping?.sourceEntityId) {
          const [se] = await db.select({ name: entity.name, displayName: entity.displayName })
            .from(entity).where(eq(entity.id, mapping.sourceEntityId)).limit(1);
          sourceEntityName = se?.displayName || se?.name || undefined;
        }
        if (mapping?.sourceFieldId) {
          const [sf] = await db.select({ name: field.name, displayName: field.displayName })
            .from(field).where(eq(field.id, mapping.sourceFieldId)).limit(1);
          sourceFieldName = sf?.displayName || sf?.name || undefined;
        }

        if (sourceEntityName) {
          // Load BQ config
          const [ws] = await db.select({ settings: workspace.settings })
            .from(workspace).where(eq(workspace.id, workspaceId)).limit(1);
          const bqCfg = (ws?.settings as Record<string, unknown> | null)?.bigquery as BigQueryConfig | undefined;

          if (bqCfg) {
            const { projectId, sourceDataset } = bqCfg;

            // Poll cache for up to 3 seconds (check every 200ms)
            const pollStart = Date.now();
            while (Date.now() - pollStart < 3000) {
              if (isBaselineReady(projectId, sourceDataset, sourceEntityName, sourceFieldName)) break;
              await new Promise((r) => setTimeout(r, 200));
            }

            const baseline = getBaselineData(projectId, sourceDataset, sourceEntityName, sourceFieldName);
            if (baseline && (baseline.sampleRows.length > 0 || baseline.rowCount > 0)) {
              // Inject into system message content
              const updatedContent = injectBaselineData(systemMsg.content, baseline);

              // Also inject restrictive BQ instructions into system message
              const restrictiveInstructions = `\n\nIMPORTANT: Source data preview is PRE-LOADED in context. Do NOT re-query for sample rows, null rates, or distinct values already shown.`;
              const finalContent = updatedContent.includes("PRE-LOADED")
                ? updatedContent
                : updatedContent + restrictiveInstructions;

              // Update system message in DB
              await db.update(chatMessage)
                .set({ content: finalContent })
                .where(
                  and(
                    eq(chatMessage.sessionId, sessionId),
                    eq(chatMessage.role, "system")
                  )
                )
                ;

              // Update in-memory reference
              systemMsg = { ...systemMsg, content: finalContent };
            }
          }
        }
      } catch {
        // Non-critical — proceed without baseline injection
      }
    }

    // Resolve provider
    let provider;
    let providerName: string;
    try {
      const resolved = await resolveProvider(userId);
      provider = resolved.provider;
      providerName = resolved.providerName;
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Failed to resolve provider",
        },
        { status: 400 }
      );
    }

    // Load workspace settings for tool configuration
    let tools: ToolDefinition[] = [];
    let bqConfig: BigQueryConfig | undefined;
    let ragEnabled = true;
    try {
      const ws = (await db
        .select({ settings: workspace.settings })
        .from(workspace)
        .where(eq(workspace.id, workspaceId))
        )[0];
      const wsSettings = ws?.settings as Record<string, unknown> | null;
      bqConfig = wsSettings?.bigquery as BigQueryConfig | undefined;
      ragEnabled = wsSettings?.ragMode !== false;

      if (bqConfig) {
        tools.push(getBigQueryToolDefinition(bqConfig));
      }
    } catch {
      // Non-critical — proceed without BQ tools
    }

    // Register RAG tools — always available, query local SQLite
    if (ragEnabled) {
      tools.push(
        getSourceSchemaToolDefinition(),
        getReferenceDocsToolDefinition(),
        getSiblingMappingsToolDefinition(),
        getMappingExamplesToolDefinition(),
      );
    }

    // Load session metadata for RAG tool context
    const sessionEntityId = session.entityId || "";
    const sessionTargetFieldId = session.targetFieldId || "";

    // Stream response via SSE
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        let fullContent = "";
        let mappingUpdate: Record<string, unknown> | null = null;
        let entityMappingUpdates: Record<string, unknown>[] | null = null;
        let pipelineStructureUpdate: Record<string, unknown> | null = null;
        const isEntitySession = !session.fieldMappingId && !!session.entityId;
        let sourceDataLoaded = false;
        let cachedSourceEntities: { id: string; name: string }[] = [];
        let cachedSourceFields: { id: string; name: string; entityId: string }[] = [];
        const allToolCalls: Array<{ name: string; sql: string; purpose: string; success: boolean; durationMs: number }> = [];
        let toolResultTokenBudget = MAX_TOOL_RESULT_TOKENS;

        // Working copy of messages for the tool loop
        // Start as plain strings; promote to content-block arrays when entering tool loop
        let loopMessages: Array<{
          role: "user" | "assistant";
          content: string | Array<Record<string, unknown>>;
        }> = conversationMessages.map((m) => ({ ...m }));

        try {
          let toolRound = 0;

          while (toolRound <= MAX_TOOL_ROUNDS) {
            toolRound++;

            let stopReason: "end_turn" | "tool_use" | "max_tokens" | undefined;
            const pendingToolCalls: ToolCall[] = [];
            // Collect assistant content blocks for this round
            const assistantContentBlocks: Array<Record<string, unknown>> = [];
            let roundText = "";

            const chunks = provider.generateStream({
              systemMessage: systemMsg?.content || "",
              messages: loopMessages,
              temperature: 0.3,
              maxTokens: 4096,
              ...(tools.length > 0 ? { tools } : {}),
            });

            for await (const chunk of chunks) {
              if (chunk.type === "text" && chunk.content) {
                roundText += chunk.content;
                fullContent += chunk.content;

                // Send text chunk
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: "text", content: chunk.content })}\n\n`
                  )
                );

                // Check for mapping-update or entity-mapping-updates block as it streams
                if (isEntitySession) {
                  // Entity-level: parse entity-mapping-updates (JSON array)
                  const entityUpdateMatch = fullContent.match(
                    /```entity-mapping-updates\s*\n([\s\S]*?)\n\s*```/
                  );
                  if (entityUpdateMatch && !entityMappingUpdates) {
                    try {
                      const parsed = JSON.parse(entityUpdateMatch[1]) as Record<string, unknown>[];

                      // Lazy-load source data for name→ID resolution
                      if (!sourceDataLoaded) {
                        cachedSourceEntities = await db
                          .select({ id: entity.id, name: entity.name })
                          .from(entity)
                          .where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "source")))
                          ;
                        const seIds = cachedSourceEntities.map((e) => e.id);
                        cachedSourceFields = seIds.length > 0
                          ? (await db
                              .select({ id: field.id, name: field.name, entityId: field.entityId })
                              .from(field)
                              )
                              .filter((f) => seIds.includes(f.entityId))
                          : [];
                        sourceDataLoaded = true;
                      }

                      entityMappingUpdates = parsed.map((u) =>
                        resolveMappingUpdateIds(u, cachedSourceEntities, cachedSourceFields)
                      );

                      controller.enqueue(
                        encoder.encode(
                          `data: ${JSON.stringify({ type: "entity_mapping_updates", content: entityMappingUpdates })}\n\n`
                        )
                      );
                    } catch {
                      // JSON not complete yet, will retry on next chunk
                    }
                  }

                  // Parse pipeline-structure-update block (single JSON object)
                  const pipelineUpdateMatch = fullContent.match(
                    /```pipeline-structure-update\s*\n([\s\S]*?)\n\s*```/
                  );
                  if (pipelineUpdateMatch && !pipelineStructureUpdate) {
                    try {
                      pipelineStructureUpdate = JSON.parse(pipelineUpdateMatch[1]) as Record<string, unknown>;

                      controller.enqueue(
                        encoder.encode(
                          `data: ${JSON.stringify({ type: "pipeline_structure_update", content: pipelineStructureUpdate })}\n\n`
                        )
                      );
                    } catch {
                      // JSON not complete yet, will retry on next chunk
                    }
                  }
                } else {
                  // Field-level: parse mapping-update (single object)
                  const updateMatch = fullContent.match(
                    /```mapping-update\s*\n([\s\S]*?)\n\s*```/
                  );
                  if (updateMatch && !mappingUpdate) {
                    try {
                      const parsed = JSON.parse(updateMatch[1]) as Record<string, unknown>;

                      // Lazy-load source data for name→ID resolution
                      if (!sourceDataLoaded) {
                        cachedSourceEntities = await db
                          .select({ id: entity.id, name: entity.name })
                          .from(entity)
                          .where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "source")))
                          ;
                        const seIds = cachedSourceEntities.map((e) => e.id);
                        cachedSourceFields = seIds.length > 0
                          ? (await db
                              .select({ id: field.id, name: field.name, entityId: field.entityId })
                              .from(field)
                              )
                              .filter((f) => seIds.includes(f.entityId))
                          : [];
                        sourceDataLoaded = true;
                      }

                      mappingUpdate = resolveMappingUpdateIds(
                        parsed,
                        cachedSourceEntities,
                        cachedSourceFields
                      );

                      controller.enqueue(
                        encoder.encode(
                          `data: ${JSON.stringify({ type: "mapping_update", content: mappingUpdate })}\n\n`
                        )
                      );
                    } catch {
                      // JSON not complete yet, will retry on next chunk
                    }
                  }
                }
              }

              if (chunk.type === "tool_use" && chunk.toolCall) {
                pendingToolCalls.push(chunk.toolCall);
              }

              if (chunk.type === "stop" && chunk.stopReason) {
                stopReason = chunk.stopReason;
              }

              if (chunk.type === "usage") {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: "usage", inputTokens: chunk.inputTokens, outputTokens: chunk.outputTokens })}\n\n`
                  )
                );
              }
            }

            // If no tool use, we're done
            if (stopReason !== "tool_use" || pendingToolCalls.length === 0) {
              break;
            }

            // Build assistant content blocks for this round
            if (roundText) {
              assistantContentBlocks.push({ type: "text", text: roundText });
            }
            for (const tc of pendingToolCalls) {
              assistantContentBlocks.push({
                type: "tool_use",
                id: tc.id,
                name: tc.name,
                input: tc.input,
              });
            }

            // Append assistant turn with content blocks
            loopMessages.push({
              role: "assistant",
              content: assistantContentBlocks,
            });

            // Execute each tool call and build tool_result messages
            const toolResultBlocks: Array<Record<string, unknown>> = [];

            for (const tc of pendingToolCalls) {
              // SSE: tool_start
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: "tool_start",
                    toolName: tc.name,
                    purpose: (tc.input as { purpose?: string }).purpose ||
                      (tc.input as { query?: string }).query || "",
                    sql: (tc.input as { sql?: string }).sql || "",
                  })}\n\n`
                )
              );

              if (tc.name === "query_bigquery" && bqConfig) {
                const result = await executeBigQueryTool(
                  tc.input as { sql: string; purpose: string },
                  bqConfig
                );

                // Track for audit
                allToolCalls.push({
                  name: tc.name,
                  sql: result.sql,
                  purpose: result.purpose,
                  success: result.success,
                  durationMs: result.durationMs,
                });

                // SSE: tool_result
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "tool_result",
                      ...formatToolResultForClient(result),
                    })}\n\n`
                  )
                );

                // Build LLM tool_result content
                const llmContent = formatToolResultForLLM(result);
                toolResultTokenBudget -= llmContent.length;

                toolResultBlocks.push({
                  type: "tool_result",
                  tool_use_id: tc.id,
                  content: llmContent,
                });

                // Append inline summary to fullContent for persistence
                const statusLabel = result.success
                  ? `${result.rowCount} row${result.rowCount !== 1 ? "s" : ""}`
                  : `Error: ${result.error}`;
                fullContent += `\n\n---\n**BigQuery**: ${result.purpose}\n\`\`\`sql\n${result.sql}\n\`\`\`\nResult: ${statusLabel}\n---\n\n`;

              } else if (tc.name === "search_source_schema") {
                const result = await executeSourceSchemaSearch(
                  tc.input as unknown as SourceSchemaInput,
                  workspaceId
                );
                const llmContent = formatSourceSchemaForLLM(result);
                toolResultTokenBudget -= llmContent.length;

                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "tool_result",
                      ...formatSourceSchemaForClient(result),
                    })}\n\n`
                  )
                );
                toolResultBlocks.push({
                  type: "tool_result",
                  tool_use_id: tc.id,
                  content: llmContent,
                });
                allToolCalls.push({
                  name: tc.name,
                  sql: "",
                  purpose: `Search: ${result.query}`,
                  success: result.success,
                  durationMs: 0,
                });

              } else if (tc.name === "get_reference_docs") {
                const result = await executeReferenceDocRetrieval(
                  tc.input as unknown as ReferenceDocsInput,
                  workspaceId
                );
                const llmContent = formatReferenceDocsForLLM(result);
                toolResultTokenBudget -= llmContent.length;

                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "tool_result",
                      ...formatReferenceDocsForClient(result),
                    })}\n\n`
                  )
                );
                toolResultBlocks.push({
                  type: "tool_result",
                  tool_use_id: tc.id,
                  content: llmContent,
                });
                allToolCalls.push({
                  name: tc.name,
                  sql: "",
                  purpose: `Docs: ${result.query}`,
                  success: result.success,
                  durationMs: 0,
                });

              } else if (tc.name === "get_sibling_mappings") {
                const result = await executeSiblingMappingLookup(
                  tc.input as unknown as SiblingMappingsInput,
                  workspaceId,
                  sessionEntityId,
                  sessionTargetFieldId
                );
                const llmContent = formatSiblingMappingsForLLM(result);
                toolResultTokenBudget -= llmContent.length;

                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "tool_result",
                      ...formatSiblingMappingsForClient(result),
                    })}\n\n`
                  )
                );
                toolResultBlocks.push({
                  type: "tool_result",
                  tool_use_id: tc.id,
                  content: llmContent,
                });
                allToolCalls.push({
                  name: tc.name,
                  sql: "",
                  purpose: `Siblings: ${result.filter}`,
                  success: result.success,
                  durationMs: 0,
                });

              } else if (tc.name === "get_mapping_examples") {
                const result = await executeMappingExampleSearch(
                  tc.input as unknown as MappingExamplesInput,
                  workspaceId,
                  sessionEntityId
                );
                const llmContent = formatMappingExamplesForLLM(result);
                toolResultTokenBudget -= llmContent.length;

                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "tool_result",
                      ...formatMappingExamplesForClient(result),
                    })}\n\n`
                  )
                );
                toolResultBlocks.push({
                  type: "tool_result",
                  tool_use_id: tc.id,
                  content: llmContent,
                });
                allToolCalls.push({
                  name: tc.name,
                  sql: "",
                  purpose: `Examples: ${result.fieldType}`,
                  success: result.success,
                  durationMs: 0,
                });

              } else {
                // Unknown tool — return error
                toolResultBlocks.push({
                  type: "tool_result",
                  tool_use_id: tc.id,
                  content: `Unknown tool: ${tc.name}`,
                  is_error: true,
                });
              }
            }

            // Append tool results as a user turn (Anthropic API format)
            loopMessages.push({
              role: "user",
              content: toolResultBlocks,
            });

            // Check token budget
            if (toolResultTokenBudget <= 0) {
              // Append a note and break — let the LLM summarize what it has
              loopMessages.push({
                role: "user",
                content: "Tool result token budget exceeded. Please summarize the data you've gathered so far.",
              });
              // Do one more round without tools to get the summary
              tools = [];
            }
          }

          // Save assistant message
          const msgNow = new Date().toISOString();
          const msgMetadata: Record<string, unknown> = {
            provider: providerName,
            mappingUpdate: mappingUpdate || undefined,
            ...(entityMappingUpdates ? { entityMappingUpdates } : {}),
            ...(pipelineStructureUpdate ? { pipelineStructureUpdate } : {}),
            ...(allToolCalls.length > 0 ? { toolCalls: allToolCalls } : {}),
          };
          await db.insert(chatMessage)
            .values({
              sessionId,
              role: "assistant",
              content: fullContent,
              metadata: msgMetadata as typeof chatMessage.$inferInsert.metadata,
              createdAt: msgNow,
            });

          // Extract and persist CONTEXT GAP flags
          const contextGaps = await extractAndPersistContextGaps(fullContent, {
            workspaceId,
            entityId: session.entityId || "",
            fieldId: session.targetFieldId || undefined,
            fieldMappingId: session.fieldMappingId || null,
            chatSessionId: sessionId,
          });

          if (contextGaps.length > 0) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "context_gaps", content: contextGaps })}\n\n`
              )
            );
          }

          // Update session
          await db.update(chatSession)
            .set({
              messageCount: allMessages.length + 1,
              lastMessageAt: msgNow,
              updatedAt: msgNow,
            })
            .where(eq(chatSession.id, sessionId))
            ;

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "done" })}\n\n`
            )
          );
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : "Stream error";
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", error: errorMsg })}\n\n`
            )
          );
        } finally {
          controller.close();
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  },
  { requiredRole: "editor" }
);
