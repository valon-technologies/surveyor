import yaml from "js-yaml";
import { db } from "@/lib/db";
import { entityPipeline, field, fieldMapping, entity, generation } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { dryRunQuery } from "@/lib/bigquery/gestalt-client";
import {
  renderExecutableSql,
  diagnoseBqError,
  collectColumnRefs,
  nullifyBadColumns,
  type BqSqlConfig,
} from "@/lib/pipeline/sql-renderer";
import type { PipelineColumn, EntityPipelineWithColumns } from "@/types/pipeline";
import { parseYamlOutput, type YamlParseResult } from "./output-parser";
import { persistEntityPipeline } from "./runner";
import { resolveProvider } from "./provider-resolver";

// ─── Types ──────────────────────────────────────────────────────

export interface VerifyPipelineInput {
  workspaceId: string;
  entityId: string;
  entityName: string;
  bqConfig: { projectId: string; sourceDataset: string };
  generationId?: string;
  batchRunId?: string;
  /** Used to resolve provider + build resolution context for correction */
  userId?: string;
  preferredProvider?: "claude" | "openai";
  model?: string;
  /** Original prompt snapshot for building correction context */
  promptSnapshot?: { systemMessage?: string; userMessage?: string };
}

export interface VerifyPipelineResult {
  status: "passed" | "corrected" | "flagged" | "skipped";
  error?: string;
  correctedColumns?: string[];
  flaggedColumns?: string[];
}

// ─── Main Entry Point ───────────────────────────────────────────

/**
 * Post-generation SQL verification with auto-correction.
 *
 * Phase A: Dry-run the rendered SQL against BigQuery (free, instant).
 * Phase B: Diagnose error — classify into correctable vs non-correctable.
 * Phase C: For correctable errors, feed diagnosis to LLM for one fix attempt.
 * Fallback: Flag affected mappings as needs_discussion, nullify bad columns.
 */
export async function verifyAndCorrectPipeline(
  input: VerifyPipelineInput,
): Promise<VerifyPipelineResult> {
  const { workspaceId, entityId, bqConfig } = input;
  const now = new Date().toISOString();

  // Load latest pipeline for entity
  const pipeline = db
    .select()
    .from(entityPipeline)
    .where(
      and(eq(entityPipeline.entityId, entityId), eq(entityPipeline.isLatest, true)),
    )
    .get();

  if (!pipeline) {
    return { status: "skipped", error: "No pipeline found" };
  }

  // Parse columns from YAML spec
  const parsed = yaml.load(pipeline.yamlSpec) as Record<string, unknown>;
  const columns = (parsed?.columns as PipelineColumn[]) ?? [];

  if (columns.length === 0) {
    db.update(entityPipeline)
      .set({ sqlValidationStatus: "skipped", sqlValidationAt: now, updatedAt: now })
      .where(eq(entityPipeline.id, pipeline.id))
      .run();
    return { status: "skipped", error: "No columns in pipeline" };
  }

  // Build enriched pipeline for SQL renderer
  const enriched = buildEnrichedPipeline(pipeline, columns);

  const sqlConfig: BqSqlConfig = {
    projectId: bqConfig.projectId,
    sourceDataset: bqConfig.sourceDataset,
  };

  // ── Phase A: Dry Run ──────────────────────────────────────────

  let sql: string;
  try {
    sql = renderExecutableSql(enriched, sqlConfig, 0);
  } catch (renderErr) {
    const msg = renderErr instanceof Error ? renderErr.message : String(renderErr);
    db.update(entityPipeline)
      .set({
        sqlValidationStatus: "failed",
        sqlValidationError: `Render error: ${msg}`.slice(0, 2000),
        sqlValidationAt: now,
        updatedAt: now,
      })
      .where(eq(entityPipeline.id, pipeline.id))
      .run();
    return { status: "flagged", error: msg };
  }

  const dryResult = await dryRunQuery(bqConfig.projectId, sql);

  if (dryResult.valid) {
    db.update(entityPipeline)
      .set({
        sqlValidationStatus: "passed",
        sqlValidationError: null,
        sqlValidationAt: now,
        updatedAt: now,
      })
      .where(eq(entityPipeline.id, pipeline.id))
      .run();
    console.log(`[verifier] SQL validation passed for "${input.entityName}"`);
    return { status: "passed" };
  }

  // ── Phase B: Diagnose ─────────────────────────────────────────

  const diagnosis = diagnoseBqError(dryResult.error!);
  console.log(
    `[verifier] SQL validation failed for "${input.entityName}": ${diagnosis.type}`,
    diagnosis.type === "column_not_found" ? diagnosis.badRefs : diagnosis.badTables,
  );

  // Only column_not_found and table_not_found are correctable
  const correctable = diagnosis.type === "column_not_found" || diagnosis.type === "table_not_found";

  if (!correctable || !input.userId) {
    return flagPipeline(pipeline, enriched, diagnosis, workspaceId, entityId, now);
  }

  // ── Phase C: LLM Correction (one attempt) ─────────────────────

  try {
    const correctionResult = await attemptLLMCorrection(
      input,
      pipeline,
      enriched,
      diagnosis,
      sqlConfig,
    );

    if (correctionResult) {
      console.log(
        `[verifier] LLM correction succeeded for "${input.entityName}", ` +
        `corrected columns: ${correctionResult.correctedColumns.join(", ")}`,
      );
      return {
        status: "corrected",
        correctedColumns: correctionResult.correctedColumns,
      };
    }
  } catch (corrErr) {
    console.warn(
      `[verifier] LLM correction failed for "${input.entityName}":`,
      corrErr instanceof Error ? corrErr.message : corrErr,
    );
  }

  // ── Fallback: Flag ────────────────────────────────────────────

  return flagPipeline(pipeline, enriched, diagnosis, workspaceId, entityId, now);
}

// ─── Helpers ────────────────────────────────────────────────────

function buildEnrichedPipeline(
  pipeline: typeof entityPipeline.$inferSelect,
  columns: PipelineColumn[],
): EntityPipelineWithColumns {
  return {
    id: pipeline.id,
    workspaceId: pipeline.workspaceId,
    entityId: pipeline.entityId,
    version: pipeline.version,
    parentId: pipeline.parentId,
    isLatest: pipeline.isLatest,
    yamlSpec: pipeline.yamlSpec,
    tableName: pipeline.tableName,
    primaryKey: pipeline.primaryKey,
    sources: pipeline.sources as EntityPipelineWithColumns["sources"],
    joins: pipeline.joins as EntityPipelineWithColumns["joins"],
    concat: pipeline.concat as EntityPipelineWithColumns["concat"],
    structureType: pipeline.structureType as "flat" | "assembly",
    isStale: pipeline.isStale,
    sqlValidationStatus: pipeline.sqlValidationStatus ?? null,
    sqlValidationError: pipeline.sqlValidationError ?? null,
    sqlValidationAt: pipeline.sqlValidationAt ?? null,
    generationId: pipeline.generationId,
    batchRunId: pipeline.batchRunId,
    editedBy: pipeline.editedBy,
    changeSummary: pipeline.changeSummary,
    createdAt: pipeline.createdAt,
    updatedAt: pipeline.updatedAt,
    columns,
  };
}

/**
 * Flag affected mappings as needs_discussion, nullify bad columns,
 * and mark pipeline as failed.
 */
function flagPipeline(
  pipeline: typeof entityPipeline.$inferSelect,
  enriched: EntityPipelineWithColumns,
  diagnosis: ReturnType<typeof diagnoseBqError>,
  workspaceId: string,
  entityId: string,
  now: string,
): VerifyPipelineResult {
  const flaggedColumns: string[] = [];

  if (diagnosis.badRefs.length > 0) {
    // Identify which target columns reference bad sources
    for (const col of enriched.columns) {
      const refs = collectColumnRefs(col);
      const hasBad = refs.some((r) =>
        diagnosis.badRefs.some((br) => br.toLowerCase() === r.toLowerCase()),
      );
      if (hasBad) {
        flaggedColumns.push(col.target_column);
      }
    }

    // Flag affected field mappings
    flagFieldMappings(workspaceId, entityId, flaggedColumns, diagnosis.rawError, now);

    // Nullify bad columns in pipeline and persist
    const { pipeline: cleaned } = nullifyBadColumns(enriched, diagnosis.badRefs);
    try {
      const cleanedYaml = rebuildYamlSpec(pipeline.yamlSpec, cleaned.columns);
      db.update(entityPipeline)
        .set({
          yamlSpec: cleanedYaml,
          sqlValidationStatus: "failed",
          sqlValidationError: diagnosis.rawError.slice(0, 2000),
          sqlValidationAt: now,
          changeSummary: `Nullified ${flaggedColumns.length} column(s) with bad refs: ${diagnosis.badRefs.join(", ")}`,
          updatedAt: now,
        })
        .where(eq(entityPipeline.id, pipeline.id))
        .run();
    } catch {
      // Just mark as failed without modifying YAML
      db.update(entityPipeline)
        .set({
          sqlValidationStatus: "failed",
          sqlValidationError: diagnosis.rawError.slice(0, 2000),
          sqlValidationAt: now,
          updatedAt: now,
        })
        .where(eq(entityPipeline.id, pipeline.id))
        .run();
    }
  } else {
    // Non-column errors — just mark as failed
    db.update(entityPipeline)
      .set({
        sqlValidationStatus: "failed",
        sqlValidationError: diagnosis.rawError.slice(0, 2000),
        sqlValidationAt: now,
        updatedAt: now,
      })
      .where(eq(entityPipeline.id, pipeline.id))
      .run();
  }

  return {
    status: "flagged",
    error: diagnosis.rawError.slice(0, 500),
    flaggedColumns,
  };
}

/**
 * Mark field mappings referencing broken columns as needs_discussion.
 */
function flagFieldMappings(
  workspaceId: string,
  entityId: string,
  targetColumnNames: string[],
  errorMessage: string,
  now: string,
): void {
  if (targetColumnNames.length === 0) return;

  const entityFields = db
    .select({ id: field.id, name: field.name })
    .from(field)
    .where(eq(field.entityId, entityId))
    .all();

  const nameToFieldId = new Map(entityFields.map((f) => [f.name.toLowerCase(), f.id]));

  for (const colName of targetColumnNames) {
    const fieldId = nameToFieldId.get(colName.toLowerCase());
    if (!fieldId) continue;

    const fm = db
      .select()
      .from(fieldMapping)
      .where(
        and(
          eq(fieldMapping.targetFieldId, fieldId),
          eq(fieldMapping.workspaceId, workspaceId),
          eq(fieldMapping.isLatest, true),
        ),
      )
      .get();

    if (fm) {
      db.update(fieldMapping)
        .set({
          status: "needs_discussion",
          notes: `SQL validation error: ${errorMessage.slice(0, 200)}. ${fm.notes || ""}`.trim(),
          updatedAt: now,
        })
        .where(eq(fieldMapping.id, fm.id))
        .run();
    }
  }
}

/**
 * Attempt to correct the pipeline YAML by feeding the error to the LLM.
 * Returns null if correction fails or doesn't improve the SQL.
 */
async function attemptLLMCorrection(
  input: VerifyPipelineInput,
  pipeline: typeof entityPipeline.$inferSelect,
  enriched: EntityPipelineWithColumns,
  diagnosis: ReturnType<typeof diagnoseBqError>,
  sqlConfig: BqSqlConfig,
): Promise<{ correctedColumns: string[] } | null> {
  const { workspaceId, entityId, userId, preferredProvider, model } = input;
  if (!userId) return null;

  const { provider } = resolveProvider(userId, preferredProvider);

  // Build a compact correction prompt
  const affectedColumns: string[] = [];
  for (const col of enriched.columns) {
    const refs = collectColumnRefs(col);
    const hasBad = refs.some((r) =>
      [...diagnosis.badRefs, ...diagnosis.badTables].some(
        (br) => br.toLowerCase() === r.toLowerCase() || r.toLowerCase().includes(br.toLowerCase()),
      ),
    );
    if (hasBad) affectedColumns.push(col.target_column);
  }

  // Load source field names for the source tables in this pipeline
  const sourceInfo = buildSourceFieldList(workspaceId, enriched);

  const correctionPrompt = buildCorrectionPrompt(
    pipeline.yamlSpec,
    diagnosis,
    affectedColumns,
    sourceInfo,
  );

  // Build resolution context from the entity's fields
  const targetFields = db
    .select()
    .from(field)
    .where(eq(field.entityId, entityId))
    .orderBy(field.sortOrder)
    .all();

  const sourceEntities = db
    .select()
    .from(entity)
    .where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "source")))
    .all();

  const allSourceFields = db
    .select()
    .from(field)
    .all()
    .filter((f) => sourceEntities.some((e) => e.id === f.entityId));

  const resolutionCtx = {
    targetFields: targetFields.map((f) => ({ id: f.id, name: f.name, entityId: f.entityId })),
    sourceEntities: sourceEntities.map((e) => ({ id: e.id, name: e.name })),
    sourceFields: allSourceFields.map((f) => ({ id: f.id, name: f.name, entityId: f.entityId })),
    requestedFieldNames: targetFields.map((f) => f.name),
  };

  // Call LLM
  const response = await provider.generateCompletion({
    systemMessage:
      "You are a data mapping correction assistant. Fix the YAML pipeline based on the error diagnosis. " +
      "Output ONLY the corrected YAML, no explanations. Preserve the exact same structure — only fix the broken column references.",
    userMessage: correctionPrompt,
    model,
    maxTokens: 8192,
    temperature: 0,
  });

  // Parse corrected YAML
  const correctedParsed = parseYamlOutput(response.content, resolutionCtx);
  if (!correctedParsed.yamlParsed) return null;

  // Re-render and dry-run
  const correctedColumns = (
    yaml.load(correctedParsed.yamlOutput) as Record<string, unknown>
  )?.columns as PipelineColumn[] ?? [];

  if (correctedColumns.length === 0) return null;

  const correctedEnriched = buildEnrichedPipeline(
    pipeline,
    correctedColumns,
  );

  let correctedSql: string;
  try {
    correctedSql = renderExecutableSql(correctedEnriched, sqlConfig, 0);
  } catch {
    return null;
  }

  const revalidation = await dryRunQuery(input.bqConfig.projectId, correctedSql);
  if (!revalidation.valid) {
    console.warn(
      `[verifier] Correction still fails for "${input.entityName}":`,
      revalidation.error?.slice(0, 200),
    );
    return null;
  }

  // Correction succeeded — persist new pipeline version
  const now = new Date().toISOString();

  persistEntityPipeline({
    workspaceId,
    entityId,
    yamlResult: correctedParsed,
    generationId: input.generationId ?? pipeline.generationId ?? "correction",
    batchRunId: input.batchRunId,
  });

  // Update the new latest pipeline's validation status
  const newPipeline = db
    .select()
    .from(entityPipeline)
    .where(
      and(eq(entityPipeline.entityId, entityId), eq(entityPipeline.isLatest, true)),
    )
    .get();

  if (newPipeline) {
    db.update(entityPipeline)
      .set({
        sqlValidationStatus: "passed",
        sqlValidationError: null,
        sqlValidationAt: now,
        changeSummary: `Auto-corrected ${affectedColumns.length} column(s) from SQL validation`,
        updatedAt: now,
      })
      .where(eq(entityPipeline.id, newPipeline.id))
      .run();
  }

  return { correctedColumns: affectedColumns };
}

/**
 * Build a compact prompt for the LLM to fix broken column references.
 */
function buildCorrectionPrompt(
  yamlSpec: string,
  diagnosis: ReturnType<typeof diagnoseBqError>,
  affectedColumns: string[],
  sourceInfo: string,
): string {
  const lines: string[] = [];

  lines.push("## Original YAML Pipeline");
  lines.push("```yaml");
  lines.push(yamlSpec);
  lines.push("```");
  lines.push("");

  lines.push("## BigQuery Error");
  lines.push(`Error type: ${diagnosis.type}`);
  if (diagnosis.badRefs.length > 0) {
    lines.push(`Bad column references: ${diagnosis.badRefs.join(", ")}`);
  }
  if (diagnosis.badTables.length > 0) {
    lines.push(`Missing tables: ${diagnosis.badTables.join(", ")}`);
  }
  lines.push(`Raw error: ${diagnosis.rawError.slice(0, 500)}`);
  lines.push("");

  if (affectedColumns.length > 0) {
    lines.push(`## Affected Target Columns`);
    lines.push(affectedColumns.join(", "));
    lines.push("");
  }

  lines.push("## Available Source Fields");
  lines.push(sourceInfo);
  lines.push("");

  lines.push("## Instructions");
  lines.push(
    "Fix ONLY the broken column references listed above. " +
    "Replace hallucinated field names with correct ones from the available source fields, " +
    "or set the column to `transform: null` if no valid source exists. " +
    "Output the complete corrected YAML pipeline.",
  );

  return lines.join("\n");
}

/**
 * Build a compact list of available source fields for each table in the pipeline.
 */
function buildSourceFieldList(
  workspaceId: string,
  enriched: EntityPipelineWithColumns,
): string {
  const sourceEntities = db
    .select()
    .from(entity)
    .where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "source")))
    .all();

  const lines: string[] = [];

  for (const source of enriched.sources) {
    const tableName = source.table;
    const match = sourceEntities.find(
      (e) =>
        e.name === tableName ||
        e.displayName === tableName ||
        e.name.toLowerCase() === tableName.toLowerCase(),
    );

    if (!match) {
      lines.push(`### ${tableName} (alias: ${source.alias}) — NOT FOUND in source schema`);
      continue;
    }

    const fields = db
      .select({ name: field.name, dataType: field.dataType })
      .from(field)
      .where(eq(field.entityId, match.id))
      .all();

    lines.push(`### ${tableName} (alias: ${source.alias}) — ${fields.length} fields`);
    // Show all fields compactly
    const fieldList = fields.map((f) => `${f.name}${f.dataType ? ` (${f.dataType})` : ""}`);
    lines.push(fieldList.join(", "));
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Rebuild the YAML spec string with corrected columns.
 * Preserves the original structure but replaces the columns section.
 */
function rebuildYamlSpec(
  originalYaml: string,
  correctedColumns: PipelineColumn[],
): string {
  const parsed = yaml.load(originalYaml) as Record<string, unknown>;
  parsed.columns = correctedColumns;
  return yaml.dump(parsed, { lineWidth: -1, noRefs: true });
}
