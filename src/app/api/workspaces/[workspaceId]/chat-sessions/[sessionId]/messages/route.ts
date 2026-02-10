import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { chatSession, chatMessage } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod/v4";
import { resolveProvider } from "@/lib/generation/provider-resolver";

const sendMessageSchema = z.object({
  content: z.string().min(1),
  voiceInput: z.boolean().optional(),
});

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
    await db.insert(chatMessage)
      .values({
        sessionId,
        role: "user",
        content: parsed.data.content,
        metadata: parsed.data.voiceInput ? { voiceInput: true } : null,
        createdAt: now,
      });

    // Load full message history
    const allMessages = await db
      .select()
      .from(chatMessage)
      .where(eq(chatMessage.sessionId, sessionId))
      .orderBy(chatMessage.createdAt);

    // Separate system message from conversation
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
            error instanceof Error ? error.message : "Failed to resolve provider",
        },
        { status: 400 }
      );
    }

    // Stream response via SSE
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        let fullContent = "";
        let mappingUpdate: Record<string, unknown> | null = null;

        try {
          const chunks = provider.generateStream({
            systemMessage: systemMsg?.content || "",
            messages: conversationMessages,
            temperature: 0.3,
            maxTokens: 4096,
          });

          for await (const chunk of chunks) {
            if (chunk.type === "text" && chunk.content) {
              fullContent += chunk.content;

              // Send text chunk
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "text", content: chunk.content })}\n\n`
                )
              );

              // Check for mapping-update block as it streams
              const updateMatch = fullContent.match(
                /```mapping-update\s*\n([\s\S]*?)\n\s*```/
              );
              if (updateMatch && !mappingUpdate) {
                try {
                  mappingUpdate = JSON.parse(updateMatch[1]);
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

            if (chunk.type === "usage") {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "usage", inputTokens: chunk.inputTokens, outputTokens: chunk.outputTokens })}\n\n`
                )
              );
            }
          }

          // Save assistant message
          const msgNow = new Date().toISOString();
          await db.insert(chatMessage)
            .values({
              sessionId,
              role: "assistant",
              content: fullContent,
              metadata: {
                provider: providerName,
                mappingUpdate: mappingUpdate || undefined,
              },
              createdAt: msgNow,
            });

          // Update session
          await db.update(chatSession)
            .set({
              messageCount: allMessages.length + 1,
              lastMessageAt: msgNow,
              updatedAt: msgNow,
            })
            .where(eq(chatSession.id, sessionId));

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
