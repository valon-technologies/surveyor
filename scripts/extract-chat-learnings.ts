#!/usr/bin/env npx tsx
/**
 * Extract learnings from AI chat sessions into admin validation queue.
 *
 * Scans chat sessions with mapping updates or substantive conversations,
 * uses Haiku to distill transferable insights, and creates pending learning
 * records for admin validation.
 *
 * Usage:
 *   npx tsx scripts/extract-chat-learnings.ts [--dry-run] [--limit N]
 */

import { db } from "../src/lib/db";
import { chatSession, chatMessage, learning, fieldMapping, field, entity } from "../src/lib/db/schema";
import { eq, and, desc, gt, isNotNull, isNull } from "drizzle-orm";
import { resolveProvider } from "../src/lib/generation/provider-resolver";

const dryRun = process.argv.includes("--dry-run");
const limitArg = process.argv.indexOf("--limit");
const maxSessions = limitArg >= 0 ? parseInt(process.argv[limitArg + 1], 10) : 100;

const EXTRACTION_PROMPT = `You are analyzing a conversation between a mortgage data mapping reviewer and an AI assistant. The conversation is about mapping source data fields to VDS (Valon Data Schema) target fields.

Extract any transferable mapping insights from this conversation. Focus on:
1. Domain knowledge about what source fields mean or how they relate to VDS fields
2. Mapping patterns (e.g., "fields with X pattern should always map to Y")
3. Business rules or constraints mentioned by the reviewer
4. Corrections to AI suggestions that reveal important context

Rules:
- Only extract insights that would help map OTHER fields in the future (transferable knowledge)
- Skip trivial confirmations ("yes that looks right") with no new information
- Skip pure questions with no answers
- Each insight should be self-contained and understandable without the full conversation
- Format each insight as a concise statement (1-3 sentences)

If there are no transferable insights, respond with: NONE

Otherwise, respond with one insight per line, prefixed with "- ". Example:
- When mapping escrow disbursement fields, the ESCROW_LINE_TYPE in CMG's flat file maps to the escrow_type enum in VDS, with type codes 1=Tax, 2=Insurance, 3=HOA.
- Fields ending in _FLAG in the ServiceMac source are always boolean and should use mappingType "direct" with no transform.`;

interface SessionWithMessages {
  sessionId: string;
  entityId: string | null;
  entityName: string | null;
  fieldName: string | null;
  transferId: string | null;
  messages: Array<{ role: string; content: string }>;
}

async function main() {
  console.log(`=== Extract Chat Learnings${dryRun ? " (DRY RUN)" : ""} ===\n`);

  // Get workspace
  const [firstEntity] = await db.select().from(entity).limit(1);
  if (!firstEntity) { console.error("No entities"); process.exit(1); }
  const workspaceId = firstEntity.workspaceId;

  // Find sessions with substantive conversations (3+ messages)
  const sessions = await db
    .select()
    .from(chatSession)
    .where(
      and(
        eq(chatSession.workspaceId, workspaceId),
        gt(chatSession.messageCount, 2),
      )
    )
    .orderBy(desc(chatSession.updatedAt))
    .limit(maxSessions);

  console.log(`Sessions with 3+ messages: ${sessions.length}`);

  // Check which sessions already have learnings extracted
  const existingLearnings = await db
    .select({ sessionId: learning.sessionId })
    .from(learning)
    .where(
      and(
        eq(learning.workspaceId, workspaceId),
        isNotNull(learning.sessionId),
      )
    );
  const processedSessionIds = new Set(existingLearnings.map((l) => l.sessionId));

  const unprocessed = sessions.filter((s) => !processedSessionIds.has(s.id));
  console.log(`Already processed: ${sessions.length - unprocessed.length}`);
  console.log(`To process: ${unprocessed.length}\n`);

  if (unprocessed.length === 0) {
    console.log("No new sessions to process.");
    process.exit(0);
  }

  // Resolve provider (use env var fallback — no specific user)
  const { provider } = await resolveProvider("system");

  // Load messages and context for each session
  let created = 0;
  let skipped = 0;

  for (const session of unprocessed) {
    // Load messages
    const messages = await db
      .select({ role: chatMessage.role, content: chatMessage.content })
      .from(chatMessage)
      .where(eq(chatMessage.sessionId, session.id))
      .orderBy(chatMessage.createdAt);

    // Skip sessions with only system/kickoff messages
    const userMessages = messages.filter((m) => m.role === "user" && !(m.content || "").includes("Review this mapping"));
    if (userMessages.length === 0) {
      skipped++;
      continue;
    }

    // Load entity/field context
    let entityName: string | null = null;
    let fieldName: string | null = null;
    let transferId: string | null = null;

    if (session.entityId) {
      const [e] = await db.select({ name: entity.name }).from(entity).where(eq(entity.id, session.entityId));
      entityName = e?.name ?? null;
    }
    if (session.targetFieldId) {
      const [f] = await db.select({ name: field.name }).from(field).where(eq(field.id, session.targetFieldId));
      fieldName = f?.name ?? null;
    }
    if (session.fieldMappingId) {
      const [m] = await db.select({ transferId: fieldMapping.transferId }).from(fieldMapping).where(eq(fieldMapping.id, session.fieldMappingId));
      transferId = m?.transferId ?? null;
    }

    const label = `${entityName || "?"}.${fieldName || "?"}${transferId ? " (transfer)" : ""}`;

    // Build conversation text for extraction
    const conversationText = messages
      .filter((m) => m.role !== "system")
      .map((m) => `[${m.role}]: ${(m.content || "").substring(0, 2000)}`)
      .join("\n\n");

    if (conversationText.length < 100) {
      skipped++;
      continue;
    }

    console.log(`  ${label} (${messages.length} msgs)...`);

    if (dryRun) {
      skipped++;
      continue;
    }

    // Call Haiku to extract insights
    try {
      const response = await provider.generateCompletion({
        model: "claude-haiku-4-5-20251001",
        maxTokens: 1000,
        systemMessage: EXTRACTION_PROMPT,
        userMessage: `Context: Mapping field "${fieldName}" in entity "${entityName}"${transferId ? " (servicing transfer)" : " (SDT/ACDC)"}\n\nConversation:\n${conversationText}`,
      });

      const text = response.content;

      if (text.trim() === "NONE" || !text.includes("- ")) {
        skipped++;
        continue;
      }

      // Parse insights
      const insights = text
        .split("\n")
        .filter((line: string) => line.startsWith("- "))
        .map((line: string) => line.substring(2).trim())
        .filter((line: string) => line.length > 20);

      for (const insight of insights) {
        await db.insert(learning).values({
          workspaceId,
          entityId: session.entityId,
          fieldName,
          scope: fieldName ? "field" : "entity",
          content: insight,
          source: "review",
          sessionId: session.id,
          validationStatus: "pending",
        });
        created++;
      }

      console.log(`    → ${insights.length} insight${insights.length !== 1 ? "s" : ""}`);
    } catch (err) {
      console.error(`    Error: ${err}`);
    }
  }

  console.log(`\nDone: ${created} learnings created, ${skipped} sessions skipped`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
