import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import {
  chatSession,
  chatMessage,
  fieldMapping,
  field,
  entity,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod/v4";
import { assembleContext } from "@/lib/generation/context-assembler";
import { buildChatPrompt } from "@/lib/generation/chat-prompt-builder";
import { getTokenBudget } from "@/lib/generation/provider-resolver";

const createSessionSchema = z.object({
  fieldMappingId: z.string().min(1),
});

export const GET = withAuth(async (req, ctx, { workspaceId }) => {
  const sessions = await db
    .select()
    .from(chatSession)
    .where(eq(chatSession.workspaceId, workspaceId))
    .orderBy(chatSession.updatedAt);

  return NextResponse.json(sessions);
});

export const POST = withAuth(
  async (req, ctx, { userId, workspaceId }) => {
    const body = await req.json();
    const parsed = createSessionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.message },
        { status: 400 }
      );
    }

    const { fieldMappingId } = parsed.data;

    // Load mapping
    const mapping = (await db
      .select()
      .from(fieldMapping)
      .where(
        and(
          eq(fieldMapping.id, fieldMappingId),
          eq(fieldMapping.workspaceId, workspaceId)
        )
      ))[0];

    if (!mapping) {
      return NextResponse.json(
        { error: "Mapping not found" },
        { status: 404 }
      );
    }

    // Load target field and entity
    const targetField = (await db
      .select()
      .from(field)
      .where(eq(field.id, mapping.targetFieldId)))[0];

    if (!targetField) {
      return NextResponse.json(
        { error: "Target field not found" },
        { status: 404 }
      );
    }

    const targetEntity = (await db
      .select()
      .from(entity)
      .where(eq(entity.id, targetField.entityId)))[0];

    if (!targetEntity) {
      return NextResponse.json(
        { error: "Entity not found" },
        { status: 404 }
      );
    }

    // Resolve source names
    let sourceEntityName: string | null = null;
    let sourceFieldName: string | null = null;
    if (mapping.sourceEntityId) {
      const se = (await db
        .select()
        .from(entity)
        .where(eq(entity.id, mapping.sourceEntityId)))[0];
      sourceEntityName = se?.displayName || se?.name || null;
    }
    if (mapping.sourceFieldId) {
      const sf = (await db
        .select()
        .from(field)
        .where(eq(field.id, mapping.sourceFieldId)))[0];
      sourceFieldName = sf?.displayName || sf?.name || null;
    }

    // Assemble context and build system message
    const tokenBudget = getTokenBudget("claude");
    const assembledCtx = await assembleContext(
      workspaceId,
      targetEntity.name,
      tokenBudget
    );

    const { systemMessage, contextMessage } = buildChatPrompt({
      entityName: targetEntity.displayName || targetEntity.name,
      entityDescription: targetEntity.description,
      targetField: {
        name: targetField.displayName || targetField.name,
        dataType: targetField.dataType,
        isRequired: targetField.isRequired,
        description: targetField.description,
        enumValues: targetField.enumValues,
      },
      currentMapping: {
        mappingType: mapping.mappingType,
        sourceEntityName,
        sourceFieldName,
        transform: mapping.transform,
        defaultValue: mapping.defaultValue,
        enumMapping: mapping.enumMapping,
        reasoning: mapping.reasoning,
        confidence: mapping.confidence,
        notes: mapping.notes,
      },
      assembledContext: assembledCtx,
    });

    // Create session
    const sessionId = crypto.randomUUID();
    const now = new Date().toISOString();

    await db.insert(chatSession)
      .values({
        id: sessionId,
        workspaceId,
        fieldMappingId,
        targetFieldId: targetField.id,
        entityId: targetEntity.id,
        status: "active",
        messageCount: 1,
        lastMessageAt: now,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      });

    // Save system message with context
    await db.insert(chatMessage)
      .values({
        sessionId,
        role: "system",
        content: systemMessage + "\n\n" + contextMessage,
        createdAt: now,
      });

    const session = (await db
      .select()
      .from(chatSession)
      .where(eq(chatSession.id, sessionId)))[0];

    return NextResponse.json(session);
  },
  { requiredRole: "editor" }
);
