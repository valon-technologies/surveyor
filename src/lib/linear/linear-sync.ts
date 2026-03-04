/**
 * Linear → Surveyor sync.
 * Pulls entities, fields, and completed mappings from the M2.5 Linear dashboard.
 */

import { db } from "@/lib/db";
import { entity, field, fieldMapping, schemaAsset } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { fetchAllProjectIssues, type LinearIssue } from "./gestalt-linear-client";
import { parseFieldDescription, parseAcdcField } from "./description-parser";

const LINEAR_PROJECT_ID = "0ff7f176-0081-42fa-b464-94746d741c2f";

/** Linear state → Surveyor entity status */
const STATE_MAP: Record<string, string> = {
  "New Field": "not_started",
  "In Progress": "in_progress",
  "Completed": "complete",
  "Needs Implementation": "complete",
  "Needs Internal Review": "review",
  "Needs Client Review": "blocked",
  "In Validation": "in_progress",
  "Mapping Update Required": "in_progress",
  "Change Request": "in_progress",
  "Mapping Tables": "not_started",
};

export interface PullResult {
  entitiesCreated: number;
  entitiesUpdated: number;
  fieldsCreated: number;
  fieldsUpdated: number;
  mappingsImported: number;
  errors: string[];
}

export async function pullFromLinear(workspaceId: string): Promise<PullResult> {
  const result: PullResult = {
    entitiesCreated: 0,
    entitiesUpdated: 0,
    fieldsCreated: 0,
    fieldsUpdated: 0,
    mappingsImported: 0,
    errors: [],
  };

  // 1. Fetch all issues from the Linear project
  console.log("[linear-sync] Fetching issues from Linear...");
  const issues = await fetchAllProjectIssues(LINEAR_PROJECT_ID);
  console.log(`[linear-sync] Fetched ${issues.length} issues`);

  // 2. Separate entity-level vs field-level issues
  const entityIssues: LinearIssue[] = [];
  const fieldIssues: LinearIssue[] = [];

  for (const issue of issues) {
    if (issue.parent) {
      fieldIssues.push(issue);
    } else {
      entityIssues.push(issue);
    }
  }

  console.log(`[linear-sync] ${entityIssues.length} entity issues, ${fieldIssues.length} field issues`);

  // 3. Group field issues by parent entity
  const fieldsByEntity = new Map<string, LinearIssue[]>();
  for (const fi of fieldIssues) {
    const entityName = fi.parent!.title;
    if (!fieldsByEntity.has(entityName)) fieldsByEntity.set(entityName, []);
    fieldsByEntity.get(entityName)!.push(fi);
  }

  // 4. Get or create schema asset for Linear imports
  const assetId = getOrCreateSchemaAsset(workspaceId);

  // 5. Load existing entities + fields for dedup
  const existingEntities = new Map<string, { id: string; metadata: unknown }>();
  for (const e of db.select().from(entity).where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "target"))).all()) {
    existingEntities.set(e.name, { id: e.id, metadata: e.metadata });
  }

  const existingFields = new Map<string, { id: string; entityId: string; metadata: unknown }>();
  for (const f of db.select().from(field).all()) {
    const e = existingEntities.get(""); // We'll look up by entityId
    existingFields.set(`${f.entityId}|${f.name}`, { id: f.id, entityId: f.entityId, metadata: f.metadata });
  }

  // Build a faster field lookup: entityName + fieldName → field record
  const fieldLookup = new Map<string, { id: string; entityId: string }>();
  for (const e of existingEntities) {
    const [eName, eData] = e;
    const fields = db.select().from(field).where(eq(field.entityId, eData.id)).all();
    for (const f of fields) {
      fieldLookup.set(`${eName}|${f.name}`, { id: f.id, entityId: eData.id });
    }
  }

  // 6. Load source entities + fields for mapping resolution
  const sourceEntities = db.select().from(entity)
    .where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "source")))
    .all();
  const sourceEntityByName = new Map(sourceEntities.map((e) => [e.name.toLowerCase(), e]));

  const sourceFields = db.select().from(field).all();
  const sourceFieldsByEntity = new Map<string, typeof sourceFields>();
  for (const sf of sourceFields) {
    if (!sourceFieldsByEntity.has(sf.entityId)) sourceFieldsByEntity.set(sf.entityId, []);
    sourceFieldsByEntity.get(sf.entityId)!.push(sf);
  }

  // 7. Process each entity from Linear
  // Include both entity-level issues AND entities implied by field parent titles
  const allEntityNames = new Set<string>();
  for (const ei of entityIssues) allEntityNames.add(ei.title);
  for (const [eName] of fieldsByEntity) allEntityNames.add(eName);

  for (const entityName of allEntityNames) {
    const entityIssue = entityIssues.find((e) => e.title === entityName);
    const entityFields = fieldsByEntity.get(entityName) || [];

    // Extract domain tags from labels
    const labels = entityIssue?.labels.nodes.map((l) => l.name).filter((l) => l !== "entity table") || [];
    // Grab labels from field issues if entity issue doesn't have them
    if (labels.length === 0 && entityFields.length > 0) {
      const fieldLabels = entityFields[0].labels.nodes.map((l) => l.name);
      labels.push(...fieldLabels.filter((l) => !["M2", "M2.5", "M3"].includes(l)));
    }

    // Determine milestone from labels
    const milestone = entityFields.some((f) => f.labels.nodes.some((l) => l.name === "M2.5"))
      ? "M2.5"
      : entityFields.some((f) => f.labels.nodes.some((l) => l.name === "M2"))
        ? "M2"
        : entityFields.some((f) => f.labels.nodes.some((l) => l.name === "M3"))
          ? "M3"
          : null;

    const existing = existingEntities.get(entityName);

    let entityId: string;
    if (existing) {
      entityId = existing.id;
      // Update metadata with Linear issue ID if not already set
      if (entityIssue) {
        const meta = (existing.metadata as Record<string, unknown>) || {};
        if (!meta.linearIssueId) {
          db.update(entity)
            .set({
              metadata: { ...meta, linearIssueId: entityIssue.identifier, linearIssueUuid: entityIssue.id },
              updatedAt: new Date().toISOString(),
            })
            .where(eq(entity.id, entityId))
            .run();
          result.entitiesUpdated++;
        }
      }
    } else {
      // Create new entity
      entityId = crypto.randomUUID();
      db.insert(entity).values({
        id: entityId,
        workspaceId,
        schemaAssetId: assetId,
        name: entityName,
        side: "target",
        description: entityIssue?.description?.split("\n")[0] || null,
        domainTags: labels.length > 0 ? labels : null,
        status: entityIssue ? (STATE_MAP[entityIssue.state.name] || "not_started") : "not_started",
        metadata: entityIssue
          ? { linearIssueId: entityIssue.identifier, linearIssueUuid: entityIssue.id }
          : null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).run();
      existingEntities.set(entityName, { id: entityId, metadata: null });
      result.entitiesCreated++;
      console.log(`[linear-sync] Created entity: ${entityName}`);
    }

    // Process fields for this entity
    for (const fi of entityFields) {
      const parsed = parseFieldDescription(fi.description);
      const fieldName = fi.title; // Title is the field name
      const lookupKey = `${entityName}|${fieldName}`;
      const existingField = fieldLookup.get(lookupKey);

      let fieldId: string;
      if (existingField) {
        fieldId = existingField.id;
        // Update description, milestone, metadata from Linear
        const updates: Record<string, unknown> = {};
        if (parsed.definition) updates.description = parsed.definition;
        if (parsed.enumValues) updates.enumValues = parsed.enumValues;
        if (parsed.dataType) updates.dataType = normalizeDataType(parsed.dataType);
        // Always update milestone from Linear labels (Linear is authority)
        const fieldMilestone = fi.labels.nodes.some((l) => l.name === "M2.5")
          ? "M2.5"
          : fi.labels.nodes.some((l) => l.name === "M2")
            ? "M2"
            : fi.labels.nodes.some((l) => l.name === "M3")
              ? "M3"
              : null;
        if (fieldMilestone) updates.milestone = fieldMilestone;

        // Set Linear metadata
        const existingMeta = db.select({ metadata: field.metadata }).from(field).where(eq(field.id, fieldId)).get();
        const meta = (existingMeta?.metadata as Record<string, unknown>) || {};
        if (!meta.linearIssueId) {
          updates.metadata = { ...meta, linearIssueId: fi.identifier, linearIssueUuid: fi.id };
        }

        if (Object.keys(updates).length > 0) {
          updates.updatedAt = new Date().toISOString();
          db.update(field).set(updates).where(eq(field.id, fieldId)).run();
          result.fieldsUpdated++;
        }
      } else {
        // Create new field
        fieldId = crypto.randomUUID();
        db.insert(field).values({
          id: fieldId,
          entityId,
          name: fieldName,
          dataType: normalizeDataType(parsed.dataType),
          description: parsed.definition,
          isRequired: false,
          isKey: false,
          enumValues: parsed.enumValues,
          milestone,
          metadata: { linearIssueId: fi.identifier, linearIssueUuid: fi.id },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }).run();
        fieldLookup.set(lookupKey, { id: fieldId, entityId });
        result.fieldsCreated++;
      }

      // Import completed mappings
      const isCompleted = ["Completed", "Needs Implementation"].includes(fi.state.name);
      if (isCompleted && parsed.acdcField) {
        const imported = importMapping(workspaceId, fieldId, parsed, fi, sourceEntityByName, sourceFieldsByEntity);
        if (imported) result.mappingsImported++;
        if (imported === "error") result.errors.push(`Failed to resolve source for ${entityName}.${fieldName}: ${parsed.acdcField}`);
      }
    }
  }

  console.log(`[linear-sync] Done: ${result.entitiesCreated} entities created, ${result.fieldsCreated} fields created, ${result.mappingsImported} mappings imported`);
  return result;
}

function importMapping(
  workspaceId: string,
  targetFieldId: string,
  parsed: ReturnType<typeof parseFieldDescription>,
  issue: LinearIssue,
  sourceEntityByName: Map<string, { id: string; name: string }>,
  sourceFieldsByEntity: Map<string, { id: string; name: string }[]>,
): boolean | "error" {
  if (!parsed.acdcField) return false;

  // Check if a mapping already exists
  const existing = db.select().from(fieldMapping)
    .where(and(eq(fieldMapping.targetFieldId, targetFieldId), eq(fieldMapping.isLatest, true)))
    .get();
  if (existing) return false; // Don't overwrite existing mappings

  // Resolve source entity + field
  const sources = parseAcdcField(parsed.acdcField);
  if (sources.length === 0) return false;

  // Use the first source for the primary mapping
  const primary = sources[0];
  let sourceEntityId: string | null = null;
  let sourceFieldId: string | null = null;

  if (primary.sourceEntity) {
    const se = sourceEntityByName.get(primary.sourceEntity.toLowerCase());
    if (se) {
      sourceEntityId = se.id;
      const seFields = sourceFieldsByEntity.get(se.id) || [];
      const sf = seFields.find((f) => f.name.toLowerCase() === primary.sourceField.toLowerCase());
      if (sf) sourceFieldId = sf.id;
    }
  }

  db.insert(fieldMapping).values({
    id: crypto.randomUUID(),
    workspaceId,
    targetFieldId,
    status: "accepted",
    mappingType: parsed.mappingLogic && parsed.mappingLogic !== parsed.acdcField ? "derived" : "direct",
    sourceEntityId,
    sourceFieldId,
    transform: parsed.mappingLogic || null,
    reasoning: `Imported from Linear ${issue.identifier}`,
    confidence: "high",
    createdBy: "import",
    version: 1,
    isLatest: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).run();

  return true;
}

function normalizeDataType(raw: string | null): string | null {
  if (!raw) return null;
  const upper = raw.toUpperCase().trim();
  const map: Record<string, string> = {
    "STRING": "STRING",
    "VARCHAR": "STRING",
    "TEXT": "STRING",
    "NUMBER": "NUMBER",
    "INT": "NUMBER",
    "INTEGER": "NUMBER",
    "INT64": "NUMBER",
    "FLOAT": "NUMBER",
    "FLOAT64": "NUMBER",
    "DOUBLE": "NUMBER",
    "NUMERIC": "NUMBER",
    "DECIMAL": "NUMBER",
    "BOOLEAN": "BOOLEAN",
    "BOOL": "BOOLEAN",
    "DATE": "DATE",
    "DATETIME": "DATETIME",
    "TIMESTAMP": "DATETIME",
  };
  return map[upper] || raw;
}

function getOrCreateSchemaAsset(workspaceId: string): string {
  const name = "Linear M2.5 Import";
  const existing = db.select().from(schemaAsset)
    .where(and(eq(schemaAsset.workspaceId, workspaceId), eq(schemaAsset.name, name)))
    .get();
  if (existing) return existing.id;

  const id = crypto.randomUUID();
  db.insert(schemaAsset).values({
    id,
    workspaceId,
    name,
    side: "target",
    format: "linear",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).run();
  return id;
}
