import { db } from "@/lib/db";
import { learning, field, entity, fieldMapping } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { rebuildEntityKnowledge } from "./entity-knowledge";
import { emitSignal } from "./skill-signals";
import { emitFeedbackEvent } from "@/lib/feedback/emit-event";

interface MappingVersion {
  sourceEntityId: string | null;
  sourceFieldId: string | null;
  mappingType: string | null;
  transform: string | null;
  status: string;
}

interface LearningContext {
  workspaceId: string;
  targetFieldId: string;
}

/**
 * Resolve an entity ID to its display name.
 */
function resolveEntityName(entityId: string | null): string | null {
  if (!entityId) return null;
  const e = db
    .select({ name: entity.name, displayName: entity.displayName })
    .from(entity)
    .where(eq(entity.id, entityId))
    .get();
  return e?.displayName || e?.name || null;
}

/**
 * Resolve a field ID to its name.
 */
function resolveFieldName(fieldId: string | null): string | null {
  if (!fieldId) return null;
  const f = db
    .select({ name: field.name })
    .from(field)
    .where(eq(field.id, fieldId))
    .get();
  return f?.name || null;
}

/**
 * Detect significant mapping corrections and auto-create learning records.
 *
 * "Significant" means the human changed the source entity, source field,
 * or transform in a way that future LLM generations should know about.
 * Trivial edits (notes, reasoning text, confidence bumps) are ignored.
 */
export function extractMappingLearning(
  oldMapping: MappingVersion,
  newMapping: MappingVersion,
  ctx: LearningContext,
): void {
  const sourceEntityChanged =
    oldMapping.sourceEntityId !== newMapping.sourceEntityId &&
    (oldMapping.sourceEntityId !== null || newMapping.sourceEntityId !== null);

  const sourceFieldChanged =
    oldMapping.sourceFieldId !== newMapping.sourceFieldId &&
    (oldMapping.sourceFieldId !== null || newMapping.sourceFieldId !== null);

  const transformChanged =
    oldMapping.transform !== newMapping.transform &&
    (oldMapping.transform !== null || newMapping.transform !== null);

  const wasUnmapped =
    oldMapping.status === "unmapped" && newMapping.sourceFieldId !== null;

  // Only create learning for material changes
  if (!sourceEntityChanged && !sourceFieldChanged && !transformChanged && !wasUnmapped) {
    return;
  }

  // Resolve names for human-readable learning content
  const targetField = db
    .select({ name: field.name, entityId: field.entityId })
    .from(field)
    .where(eq(field.id, ctx.targetFieldId))
    .get();
  if (!targetField) return;

  const targetEntityName = resolveEntityName(targetField.entityId);
  const fieldLabel = `${targetEntityName || "unknown"}.${targetField.name}`;

  const oldEntityName = resolveEntityName(oldMapping.sourceEntityId);
  const newEntityName = resolveEntityName(newMapping.sourceEntityId);
  const oldFieldName = resolveFieldName(oldMapping.sourceFieldId);
  const newFieldName = resolveFieldName(newMapping.sourceFieldId);

  const parts: string[] = [];

  if (sourceEntityChanged && oldEntityName && newEntityName) {
    parts.push(
      `Source table corrected from "${oldEntityName}" to "${newEntityName}".`,
    );
  } else if (sourceEntityChanged && newEntityName && !oldEntityName) {
    parts.push(`Source table set to "${newEntityName}" (was unmapped).`);
  }

  if (sourceFieldChanged && oldFieldName && newFieldName) {
    const oldRef = oldEntityName ? `${oldEntityName}.${oldFieldName}` : oldFieldName;
    const newRef = newEntityName ? `${newEntityName}.${newFieldName}` : newFieldName;
    parts.push(`Source field corrected from ${oldRef} to ${newRef}.`);
  } else if (sourceFieldChanged && newFieldName && !oldFieldName) {
    const newRef = newEntityName ? `${newEntityName}.${newFieldName}` : newFieldName;
    parts.push(`Source field set to ${newRef} (was unmapped).`);
  }

  if (transformChanged && oldMapping.transform && newMapping.transform) {
    parts.push(
      `Transform corrected from "${truncate(oldMapping.transform, 80)}" to "${truncate(newMapping.transform, 80)}".`,
    );
  } else if (transformChanged && newMapping.transform && !oldMapping.transform) {
    parts.push(`Transform added: "${truncate(newMapping.transform, 120)}".`);
  } else if (transformChanged && !newMapping.transform && oldMapping.transform) {
    parts.push(`Transform removed (was: "${truncate(oldMapping.transform, 80)}"). Now identity/direct.`);
  }

  if (parts.length === 0) return;

  const content = `For ${fieldLabel}: ${parts.join(" ")}`;

  try {
    // Dedup: skip if an identical learning already exists for this entity+field+content
    const existingLearning = db
      .select({ id: learning.id })
      .from(learning)
      .where(
        and(
          eq(learning.workspaceId, ctx.workspaceId),
          eq(learning.entityId, targetField.entityId),
          eq(learning.fieldName, targetField.name),
          eq(learning.content, content),
        )
      )
      .get();

    if (existingLearning) return;

    db.insert(learning)
      .values({
        workspaceId: ctx.workspaceId,
        entityId: targetField.entityId,
        fieldName: targetField.name,
        scope: "field",
        content,
        source: "review",
      })
      .run();

    // Rebuild the entity knowledge context doc (single source of truth)
    rebuildEntityKnowledge(ctx.workspaceId, targetField.entityId);

    // Emit mapping_correction signal for skill refresh tracking
    try {
      emitSignal({
        workspaceId: ctx.workspaceId,
        entityId: targetField.entityId,
        signalType: "mapping_correction",
        summary: content,
        sourceId: ctx.targetFieldId,
        sourceType: "field_mapping",
      });
    } catch {
      // Non-critical
    }

    // Auto-detect entity boundary patterns → workspace-scoped rules
    if (sourceEntityChanged) {
      detectEntityBoundaryPattern(
        oldEntityName,
        newEntityName,
        targetField.name,
        ctx,
      );
    }
  } catch (err) {
    // Non-critical — don't fail the mapping save
    console.warn("[mapping-learning] Failed to create learning:", err);
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

// ─── Entity Boundary Detection ──────────────────────────────────

/**
 * Well-known fields that belong to specific entities, NOT the obvious default.
 * When a correction moves a field from entity A to entity B, and that field
 * is in this table, auto-create a workspace-scoped rule.
 */
const ENTITY_BOUNDARY_TABLE: Record<string, string> = {
  original_interest_rate: "loan_at_origination_info",
  original_loan_amount: "loan_at_origination_info",
  original_loan_term: "loan_at_origination_info",
  original_ltv_ratio: "loan_at_origination_info",
  original_cltv_ratio: "loan_at_origination_info",
  original_dti_ratio: "loan_at_origination_info",
  original_upb: "loan_at_origination_info",
  principal_balance: "loan_accounting_balance",
};

/**
 * Detect if a source entity correction matches a known entity boundary
 * pattern and auto-create a workspace-scoped learning.
 */
function detectEntityBoundaryPattern(
  oldEntityName: string | null,
  newEntityName: string | null,
  targetFieldName: string,
  ctx: LearningContext,
): void {
  if (!oldEntityName || !newEntityName) return;
  if (oldEntityName === newEntityName) return;

  // Check if this field is in the entity boundary table
  const expectedEntity = ENTITY_BOUNDARY_TABLE[targetFieldName.toLowerCase()];
  if (!expectedEntity) return;

  // If the correction moves the field TO the correct entity, create a workspace rule
  const newEntityNorm = newEntityName.toLowerCase().replace(/[_\s-]/g, "");
  const expectedNorm = expectedEntity.toLowerCase().replace(/[_\s-]/g, "");

  if (newEntityNorm.includes(expectedNorm) || expectedNorm.includes(newEntityNorm)) {
    const content = `Entity boundary: "${targetFieldName}" belongs to "${newEntityName}", NOT "${oldEntityName}". ` +
      `This is a known entity boundary — similar "original_*" fields should also map to "${newEntityName}".`;

    // Check for duplicate workspace rules
    const existing = db
      .select({ id: learning.id })
      .from(learning)
      .where(
        and(
          eq(learning.workspaceId, ctx.workspaceId),
          eq(learning.scope, "workspace"),
          eq(learning.content, content),
        )
      )
      .get();

    if (!existing) {
      try {
        db.insert(learning)
          .values({
            workspaceId: ctx.workspaceId,
            scope: "workspace",
            content,
            source: "review",
          })
          .run();
        console.log(`[mapping-learning] Auto-created workspace rule for entity boundary: ${targetFieldName}`);
      } catch (err) {
        console.warn("[mapping-learning] Failed to create workspace boundary rule:", err);
      }
    }
  }
}

/**
 * Create learning records from reviewer verdict feedback.
 * Called when a non-'correct' source or transform verdict is saved.
 * Triggers rebuildEntityKnowledge so the next generation sees the feedback.
 */
export function extractVerdictLearning(
  workspaceId: string,
  fieldMappingId: string,
  correlationId?: string,
): void {
  // Load verdict fields + source entity/field names from the mapping
  const mapping = db
    .select({
      id: fieldMapping.id,
      sourceVerdict: fieldMapping.sourceVerdict,
      sourceVerdictNotes: fieldMapping.sourceVerdictNotes,
      transformVerdict: fieldMapping.transformVerdict,
      transformVerdictNotes: fieldMapping.transformVerdictNotes,
      sourceEntityName: entity.name,
      sourceFieldName: field.name,
    })
    .from(fieldMapping)
    .leftJoin(entity, eq(fieldMapping.sourceEntityId, entity.id))
    .leftJoin(field, eq(fieldMapping.sourceFieldId, field.id))
    .where(eq(fieldMapping.id, fieldMappingId))
    .get();

  if (!mapping) return;

  // Load target field + entity (separate query to avoid alias conflicts)
  const targetInfo = db
    .select({
      fieldName: field.name,
      entityId: field.entityId,
      entityName: entity.name,
    })
    .from(fieldMapping)
    .innerJoin(field, eq(fieldMapping.targetFieldId, field.id))
    .innerJoin(entity, eq(field.entityId, entity.id))
    .where(eq(fieldMapping.id, fieldMappingId))
    .get();

  if (!targetInfo) return;

  const prefix = `For ${targetInfo.entityName}.${targetInfo.fieldName}`;
  const learningValues: Array<{ content: string; fieldName: string }> = [];

  // Source verdict → learning content
  if (mapping.sourceVerdict && mapping.sourceVerdict !== "correct") {
    const notesText = mapping.sourceVerdictNotes || "";
    const currentSrc =
      mapping.sourceEntityName && mapping.sourceFieldName
        ? `${mapping.sourceEntityName}.${mapping.sourceFieldName}`
        : mapping.sourceEntityName || "unknown";

    const contentMap: Record<string, string> = {
      wrong_table: `CORRECTION (MANDATORY) ${prefix}: MUST use source from ${notesText} — do NOT use ${currentSrc}.`,
      wrong_field: `CORRECTION (MANDATORY) ${prefix}: Wrong field within ${mapping.sourceEntityName || "the entity"}. ${notesText}`,
      should_be_unmapped: `CORRECTION (MANDATORY) ${prefix}: This field has NO source — set transform: null, source: []. Do NOT map it.`,
      missing_source: `CORRECTION (MANDATORY) ${prefix}: This field MUST be mapped. ${notesText}`,
    };

    const content = contentMap[mapping.sourceVerdict];
    if (content) learningValues.push({ content, fieldName: targetInfo.fieldName });
  }

  // Transform verdict → learning content
  if (mapping.transformVerdict && mapping.transformVerdict !== "correct") {
    const notesText = mapping.transformVerdictNotes || "";

    const contentMap: Record<string, string> = {
      not_needed: `CORRECTION (MANDATORY) ${prefix}: No transform required — use identity mapping directly.`,
      needed_but_missing: `CORRECTION (MANDATORY) ${prefix}: A transform is REQUIRED. ${notesText}`,
      wrong_enum: `CORRECTION (MANDATORY) ${prefix}: Enum mapping is incorrect. ${notesText}`,
      wrong_logic: `CORRECTION (MANDATORY) ${prefix}: Transform logic is wrong. ${notesText}`,
    };

    const content = contentMap[mapping.transformVerdict];
    if (content) learningValues.push({ content, fieldName: targetInfo.fieldName });
  }

  if (learningValues.length === 0) return;

  for (const lv of learningValues) {
    // Dedup: skip if an identical learning already exists for this entity+field+content
    const existing = db
      .select({ id: learning.id })
      .from(learning)
      .where(
        and(
          eq(learning.workspaceId, workspaceId),
          eq(learning.entityId, targetInfo.entityId),
          eq(learning.fieldName, lv.fieldName),
          eq(learning.content, lv.content),
        )
      )
      .get();

    if (existing) {
      continue;
    }

    const learningId = crypto.randomUUID();
    db.insert(learning).values({
      id: learningId,
      workspaceId,
      entityId: targetInfo.entityId,
      fieldName: lv.fieldName,
      scope: "field",
      source: "review",
      content: lv.content,
      validationStatus: "pending", // Requires admin validation before entering EK
    }).run();

    emitFeedbackEvent({
      workspaceId,
      entityId: targetInfo.entityId,
      fieldMappingId,
      eventType: "learning_created",
      payload: { learningId, scope: "field", content: lv.content, fieldName: lv.fieldName, validationStatus: "pending" },
      correlationId,
    });
  }

  // NOTE: rebuildEntityKnowledge is NOT called here — admin must validate first.
  // EK rebuild happens in the admin validation route when learning is approved.
}

// ─── Manual Rule Promotion ──────────────────────────────────────

/**
 * Promote a correction to a workspace-wide rule.
 * Called from the review UI when a reviewer flags a correction as a global pattern.
 */
export function promoteToWorkspaceRule(
  workspaceId: string,
  content: string,
  source: "review" | "manual" = "review",
): { id: string } {
  // Dedup: skip if a very similar rule already exists
  const existing = db
    .select({ id: learning.id, content: learning.content })
    .from(learning)
    .where(
      and(
        eq(learning.workspaceId, workspaceId),
        eq(learning.scope, "workspace"),
      )
    )
    .all();

  // Simple dedup by normalized content comparison
  const normalizedContent = content.toLowerCase().replace(/\s+/g, " ").trim();
  for (const e of existing) {
    const normalizedExisting = e.content.toLowerCase().replace(/\s+/g, " ").trim();
    if (normalizedExisting === normalizedContent) {
      return { id: e.id };
    }
  }

  // Cap at 20 workspace rules
  if (existing.length >= 20) {
    throw new Error("Maximum of 20 workspace rules reached. Remove an existing rule before adding a new one.");
  }

  const id = crypto.randomUUID();
  db.insert(learning)
    .values({
      id,
      workspaceId,
      scope: "workspace",
      content,
      source,
    })
    .run();

  return { id };
}
