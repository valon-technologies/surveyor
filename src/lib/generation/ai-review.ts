/**
 * Pre-generate AI reviews for field mappings.
 * Produces a proposed update + review text for each mapping,
 * stored in the aiReview column for instant loading in the discuss page.
 *
 * Model choices:
 * - Initial mapping generation: Opus (via batch-runner / multi-entity-eval) — highest quality for source identification
 * - AI review pass (this file): Sonnet — sufficient for analyzing existing mappings, cheaper/faster at scale
 * - Live chat (discuss page): Opus (via chat-sessions API) — highest quality for interactive dialogue
 */
import { db } from "@/lib/db";
import { fieldMapping, field, entity, context, mappingContext } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";

// Opus for reviews — highest quality, ensures source/transform consistency
const REVIEW_MODEL = "claude-opus-4-6";

const REVIEW_SYSTEM_PROMPT = `You are a senior data mapping expert reviewing a field-level mapping between a source system (ACDC/ServiceMac) and a target schema (VDS).

Your job: review the current mapping and propose corrections if needed.

FORMATTING:
- Do NOT use emojis. Use plain text markers:
  - For corrections: use "(!) " prefix
  - For blocked items: use "(X) " prefix

CONSISTENCY RULES:
- The sourceEntityName and sourceFieldName MUST match what appears in the transform expression. Do not propose source fields that are not used in the transform.
- If the transform references multiple source fields (e.g. FcRemovalCode AND FcRemovalDate), list the PRIMARY source field in sourceFieldName and reference all fields in the transform and reasoning.
- If you propose changing the source, you MUST also update the transform to use the new source. Never leave a stale transform that references the old source.
- If the transform is correct but the source field name doesn't match what the transform uses, fix the source field name to match.

OUTPUT FORMAT:
1. Brief analysis (2-4 sentences): is the source correct? Is the transform correct? Any questions?
2. If you propose changes, include a fenced block:

\`\`\`mapping-update
{
  "mappingType": "direct",
  "sourceEntityName": "table_name",
  "sourceFieldName": "column_name",
  "transform": null,
  "defaultValue": null,
  "enumMapping": null,
  "reasoning": "Updated reasoning",
  "confidence": "high",
  "notes": null,
  "question": null
}
\`\`\`

The "question" field should contain a structured follow-up question for the client when you need information to finalize the mapping. Set to null when no question is needed.

3. If the current mapping looks correct, say so briefly and do NOT include a mapping-update block.

CITATIONS: When referencing a document, include its [ref:...] tag so reviewers can trace your reasoning. Example: "Per [ref:ctx_abc123], the source should be DefaultWorkstations."

Be concise and decisive. Focus on source correctness first, then transform logic.`;

interface ReviewResult {
  proposedUpdate: Record<string, unknown> | null;
  reviewText: string;
  generatedAt: string;
  contextUsed: { id: string; name: string }[];
}

export async function generateAiReview(
  workspaceId: string,
  mappingId: string,
): Promise<ReviewResult | null> {
  // Load mapping with field and entity info
  const mapping = db.select().from(fieldMapping)
    .where(eq(fieldMapping.id, mappingId)).get();
  if (!mapping) return null;

  const targetField = db.select().from(field)
    .where(eq(field.id, mapping.targetFieldId)).get();
  if (!targetField) return null;

  const targetEntity = db.select().from(entity)
    .where(eq(entity.id, targetField.entityId)).get();
  if (!targetEntity) return null;

  // Resolve source names
  let sourceEntityName: string | null = null;
  let sourceFieldName: string | null = null;
  if (mapping.sourceEntityId) {
    const se = db.select().from(entity).where(eq(entity.id, mapping.sourceEntityId)).get();
    sourceEntityName = se?.name ?? null;
  }
  if (mapping.sourceFieldId) {
    const sf = db.select().from(field).where(eq(field.id, mapping.sourceFieldId)).get();
    sourceFieldName = sf?.name ?? null;
  }

  // Get sibling mappings for context
  const siblings = db.select({
    fieldName: field.name,
    sourceEntityId: fieldMapping.sourceEntityId,
    sourceFieldId: fieldMapping.sourceFieldId,
    confidence: fieldMapping.confidence,
    transform: fieldMapping.transform,
  })
    .from(fieldMapping)
    .innerJoin(field, eq(field.id, fieldMapping.targetFieldId))
    .where(and(
      eq(field.entityId, targetField.entityId),
      eq(fieldMapping.isLatest, true),
    ))
    .all();

  // Resolve sibling source names
  const siblingLines = siblings
    .filter(s => s.sourceEntityId)
    .map(s => {
      const se = db.select({ name: entity.name }).from(entity).where(eq(entity.id, s.sourceEntityId!)).get();
      const sf = s.sourceFieldId
        ? db.select({ name: field.name }).from(field).where(eq(field.id, s.sourceFieldId)).get()
        : null;
      return `  ${s.fieldName}: ${se?.name || "?"}.${sf?.name || "?"} (${s.confidence || "?"}) ${s.transform ? `transform: ${s.transform.slice(0, 80)}` : ""}`;
    })
    .join("\n");

  // Get entity knowledge
  const ek = db.select({ id: context.id, name: context.name, content: context.content })
    .from(context)
    .where(and(
      eq(context.workspaceId, workspaceId),
      eq(context.subcategory, "entity_knowledge"),
      eq(context.entityId, targetField.entityId),
    ))
    .get();

  // Collect context references used for this review
  const reviewContextUsed: { id: string; name: string }[] = [];
  if (ek) {
    reviewContextUsed.push({ id: ek.id, name: ek.name });
  }

  // Include contexts linked to this mapping from generation
  const linkedContexts = db.select({
    contextId: mappingContext.contextId,
    contextName: context.name,
  })
    .from(mappingContext)
    .leftJoin(context, eq(context.id, mappingContext.contextId))
    .where(eq(mappingContext.fieldMappingId, mappingId))
    .all();

  for (const lc of linkedContexts) {
    if (lc.contextId && lc.contextName && !reviewContextUsed.some((c) => c.id === lc.contextId)) {
      reviewContextUsed.push({ id: lc.contextId, name: lc.contextName });
    }
  }

  // Build the review prompt
  const userMessage = `Review this mapping:

**Target:** ${targetEntity.name}.${targetField.name}
**Data Type:** ${targetField.dataType || "unknown"}
**Description:** ${targetField.description || "none"}

**Current Mapping:**
- Source: ${sourceEntityName ? `${sourceEntityName}.${sourceFieldName || "?"}` : "unmapped"}
- Type: ${mapping.mappingType || "direct"}
- Transform: ${mapping.transform || "identity"}
- Confidence: ${mapping.confidence || "unset"}
- Reasoning: ${mapping.reasoning || "none"}

**Sibling Mappings (same entity):**
${siblingLines || "  (none)"}

${ek?.content ? `[ref:ctx_${ek.id}] **Entity Knowledge (corrections from prior reviews):**\n${ek.content}` : ""}

Analyze and propose corrections if needed.`;

  // Call Claude
  const client = new Anthropic();

  const response = await client.messages.create({
    model: REVIEW_MODEL,
    max_tokens: 2000,
    system: REVIEW_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const reviewText = response.content
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("");

  // Parse mapping-update block if present
  let proposedUpdate: Record<string, unknown> | null = null;
  const updateMatch = reviewText.match(/```mapping-update\s*\n([\s\S]*?)\n\s*```/);
  if (updateMatch) {
    try {
      proposedUpdate = JSON.parse(updateMatch[1]);
    } catch {
      // Couldn't parse — leave as null
    }
  }

  const result: ReviewResult = {
    proposedUpdate,
    reviewText: reviewText.replace(/```mapping-update[\s\S]*?```/, "").trim(),
    generatedAt: new Date().toISOString(),
    contextUsed: reviewContextUsed,
  };

  // Store on the mapping
  db.update(fieldMapping)
    .set({ aiReview: result, updatedAt: new Date().toISOString() })
    .where(eq(fieldMapping.id, mappingId))
    .run();

  return result;
}

/**
 * Generate AI reviews for all latest mappings in an entity.
 */
export async function generateEntityAiReviews(
  workspaceId: string,
  entityId: string,
  options?: { parallel?: number }
): Promise<{ reviewed: number; errors: number }> {
  const parallel = options?.parallel ?? 3;

  const mappings = db.select({ id: fieldMapping.id, targetFieldId: fieldMapping.targetFieldId })
    .from(fieldMapping)
    .innerJoin(field, eq(field.id, fieldMapping.targetFieldId))
    .where(and(
      eq(field.entityId, entityId),
      eq(fieldMapping.isLatest, true),
    ))
    .all();

  let reviewed = 0;
  let errors = 0;

  // Process in batches for parallelism
  for (let i = 0; i < mappings.length; i += parallel) {
    const batch = mappings.slice(i, i + parallel);
    const results = await Promise.allSettled(
      batch.map(m => generateAiReview(workspaceId, m.id))
    );

    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        reviewed++;
      } else {
        errors++;
        if (r.status === "rejected") {
          console.error(`  Error reviewing mapping:`, r.reason);
        }
      }
    }

    console.log(`  Reviewed ${Math.min(i + parallel, mappings.length)}/${mappings.length}...`);
  }

  return { reviewed, errors };
}
