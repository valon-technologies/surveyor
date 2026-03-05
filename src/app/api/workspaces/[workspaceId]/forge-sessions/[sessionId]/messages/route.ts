import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { chatSession, chatMessage, workspace } from "@/lib/db/schema";
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
  type SourceSchemaInput,
  type ReferenceDocsInput,
} from "@/lib/rag";
import {
  getForgeToolDefinitions,
  executeForgeToolCall,
  type ForgeToolResult,
} from "@/lib/generation/forge-tools";
import { estimateTokens } from "@/lib/llm/token-counter";

const sendMessageSchema = z.object({
  content: z.string().min(1),
  kickoff: z.boolean().optional(),
});

const MAX_TOOL_ROUNDS = 12;
const MAX_TOOL_RESULT_TOKENS = 48_000;

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

    // Verify session exists and is a forge session
    const session = (await db
      .select()
      .from(chatSession)
      .where(
        and(
          eq(chatSession.id, sessionId),
          eq(chatSession.workspaceId, workspaceId),
          eq(chatSession.sessionType, "forge")
        )
      )
      )[0];

    if (!session) {
      return NextResponse.json(
        { error: "Forge session not found" },
        { status: 404 }
      );
    }

    const now = new Date().toISOString();

    // Save user message
    const userMeta: Record<string, unknown> = {};
    if (parsed.data.kickoff) userMeta.kickoff = true;

    await db.insert(chatMessage)
      .values({
        sessionId,
        role: "user",
        content: parsed.data.content,
        metadata: Object.keys(userMeta).length > 0 ? userMeta : null,
        createdAt: now,
      })
      ;

    // Load full message history
    const allMessages = await db
      .select()
      .from(chatMessage)
      .where(eq(chatMessage.sessionId, sessionId))
      .orderBy(chatMessage.createdAt)
      ;

    const systemMsg = allMessages.find((m) => m.role === "system");
    const conversationMessages = allMessages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

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
            error instanceof Error
              ? error.message
              : "Failed to resolve provider",
        },
        { status: 400 }
      );
    }

    // Build tool set: forge-specific + reused tools
    let tools: ToolDefinition[] = [...getForgeToolDefinitions({ entityId: session.entityId || undefined })];

    // Add source schema + reference docs (always available)
    tools.push(getSourceSchemaToolDefinition(), getReferenceDocsToolDefinition());

    // Add BigQuery if configured
    let bqConfig: BigQueryConfig | undefined;
    try {
      const ws = (await db
        .select({ settings: workspace.settings })
        .from(workspace)
        .where(eq(workspace.id, workspaceId))
        )[0];
      const wsSettings = ws?.settings as Record<string, unknown> | null;
      bqConfig = wsSettings?.bigquery as BigQueryConfig | undefined;
      if (bqConfig) {
        tools.push(getBigQueryToolDefinition(bqConfig));
      }
    } catch {
      // Non-critical
    }

    // Stream response via SSE
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        let fullContent = "";
        let skillUpdateData: Record<string, unknown> | null = null;
        const allToolCalls: Array<{
          name: string;
          purpose: string;
          success: boolean;
          durationMs: number;
        }> = [];
        let toolResultTokenBudget = MAX_TOOL_RESULT_TOKENS;

        let loopMessages: Array<{
          role: "user" | "assistant";
          content: string | Array<Record<string, unknown>>;
        }> = conversationMessages.map((m) => ({ ...m }));

        try {
          let toolRound = 0;

          while (toolRound <= MAX_TOOL_ROUNDS) {
            toolRound++;

            let stopReason:
              | "end_turn"
              | "tool_use"
              | "max_tokens"
              | undefined;
            const pendingToolCalls: ToolCall[] = [];
            const assistantContentBlocks: Array<Record<string, unknown>> = [];
            let roundText = "";

            const chunks = provider.generateStream({
              systemMessage: systemMsg?.content || "",
              messages: loopMessages,
              temperature: 0.3,
              maxTokens: 16384,
              tools,
            });

            for await (const chunk of chunks) {
              if (chunk.type === "text" && chunk.content) {
                roundText += chunk.content;
                fullContent += chunk.content;

                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: "text", content: chunk.content })}\n\n`
                  )
                );

                // Parse skill-update fenced block
                const skillUpdateMatch = fullContent.match(
                  /```skill-update\s*\n([\s\S]*?)\n\s*```/
                );
                if (skillUpdateMatch && !skillUpdateData) {
                  try {
                    skillUpdateData = JSON.parse(
                      skillUpdateMatch[1]
                    ) as Record<string, unknown>;

                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({ type: "skill_update", content: skillUpdateData })}\n\n`
                      )
                    );
                  } catch {
                    // JSON not complete yet
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

            loopMessages.push({
              role: "assistant",
              content: assistantContentBlocks,
            });

            // Execute each tool call
            const toolResultBlocks: Array<Record<string, unknown>> = [];

            for (const tc of pendingToolCalls) {
              // SSE: tool_start
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: "tool_start",
                    toolName: tc.name,
                    purpose:
                      (tc.input as { purpose?: string }).purpose ||
                      (tc.input as { query?: string }).query ||
                      (tc.input as { entityName?: string }).entityName ||
                      "",
                  })}\n\n`
                )
              );

              let llmContent: string;
              let success = true;
              let summary = "";
              let durationMs = 0;
              let forgeResult: ForgeToolResult | null = null;

              // Route to appropriate executor
              if (
                [
                  "search_contexts",
                  "browse_contexts",
                  "read_context",
                  "list_target_fields",
                  "get_existing_skill",
                  "list_skills",
                  "get_mapping_feedback",
                ].includes(tc.name)
              ) {
                // Forge-specific tools
                forgeResult = await executeForgeToolCall(
                  tc.name,
                  tc.input,
                  workspaceId
                );
                llmContent = forgeResult!.data;
                success = forgeResult!.success;
                summary = forgeResult!.summary;
              } else if (tc.name === "query_bigquery" && bqConfig) {
                const result = await executeBigQueryTool(
                  tc.input as { sql: string; purpose: string },
                  bqConfig
                );
                llmContent = formatToolResultForLLM(result);
                success = result.success;
                summary = result.purpose;
                durationMs = result.durationMs;

                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "tool_result",
                      ...formatToolResultForClient(result),
                    })}\n\n`
                  )
                );
              } else if (tc.name === "search_source_schema") {
                const result = await executeSourceSchemaSearch(
                  tc.input as unknown as SourceSchemaInput,
                  workspaceId
                );
                llmContent = formatSourceSchemaForLLM(result);
                success = result.success;
                summary = `Search: ${result.query}`;

                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "tool_result",
                      ...formatSourceSchemaForClient(result),
                    })}\n\n`
                  )
                );
              } else if (tc.name === "get_reference_docs") {
                const result = await executeReferenceDocRetrieval(
                  tc.input as unknown as ReferenceDocsInput,
                  workspaceId
                );
                llmContent = formatReferenceDocsForLLM(result);
                success = result.success;
                summary = `Docs: ${result.query}`;

                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "tool_result",
                      ...formatReferenceDocsForClient(result),
                    })}\n\n`
                  )
                );
              } else {
                llmContent = `Unknown tool: ${tc.name}`;
                success = false;
                summary = `Unknown tool: ${tc.name}`;
              }

              // SSE: tool_result for forge tools
              if (
                [
                  "search_contexts",
                  "browse_contexts",
                  "read_context",
                  "list_target_fields",
                  "get_existing_skill",
                  "list_skills",
                  "get_mapping_feedback",
                ].includes(tc.name)
              ) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "tool_result",
                      toolName: tc.name,
                      success,
                      purpose: summary,
                      forgeData: forgeResult?.clientData || null,
                    })}\n\n`
                  )
                );
              }

              toolResultTokenBudget -= estimateTokens(llmContent);

              toolResultBlocks.push({
                type: "tool_result",
                tool_use_id: tc.id,
                content: llmContent,
              });

              allToolCalls.push({
                name: tc.name,
                purpose: summary,
                success,
                durationMs,
              });
            }

            // Append tool results
            loopMessages.push({
              role: "user",
              content: toolResultBlocks,
            });

            // Check token budget
            if (toolResultTokenBudget <= 0) {
              loopMessages.push({
                role: "user",
                content:
                  "Tool result token budget exceeded. Please summarize what you've gathered and propose a skill configuration.",
              });
              tools = []; // No more tools
            }
          }

          // Save assistant message
          const msgNow = new Date().toISOString();
          const msgMetadata: Record<string, unknown> = {
            provider: providerName,
            ...(skillUpdateData ? { skillUpdate: skillUpdateData } : {}),
            ...(allToolCalls.length > 0 ? { toolCalls: allToolCalls } : {}),
          };

          await db.insert(chatMessage)
            .values({
              sessionId,
              role: "assistant",
              content: fullContent,
              metadata: msgMetadata as typeof chatMessage.$inferInsert.metadata,
              createdAt: msgNow,
            })
            ;

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
