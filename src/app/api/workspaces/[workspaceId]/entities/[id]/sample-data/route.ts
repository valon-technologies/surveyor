import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import {
  entityPipeline,
  fieldMapping,
  field,
  entity as entityTable,
  workspace,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { synthesizePipelineFromMappings } from "@/lib/generation/pipeline-synthesizer";
import { rebuildPipelineYaml } from "@/lib/generation/yaml-rebuilder";
import yaml from "js-yaml";
import {
  renderExecutableSql,
  renderComponentSql,
  parseBadColumnRefs,
  nullifyBadColumns,
  type BqSqlConfig,
} from "@/lib/pipeline/sql-renderer";
import { runQuery } from "@/lib/bigquery/gestalt-client";
import type {
  EntityPipelineWithColumns,
  PipelineColumn,
} from "@/types/pipeline";
import type { BigQueryConfig } from "@/types/workspace";

export const GET = withAuth(async (req, ctx, { workspaceId }) => {
  const params = await ctx.params;
  const entityId = params.id;
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 25, 1), 200);

  // 1. Load workspace BQ config
  const wsRow = db
    .select({ settings: workspace.settings })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .get();

  const settings = (wsRow?.settings || {}) as { bigquery?: BigQueryConfig };
  const bqConfig = settings.bigquery;

  if (!bqConfig?.projectId || !bqConfig?.sourceDataset) {
    return NextResponse.json(
      { error: "BigQuery not configured", code: "BQ_NOT_CONFIGURED" },
      { status: 400 }
    );
  }

  const sqlConfig: BqSqlConfig = {
    projectId: bqConfig.projectId,
    sourceDataset: bqConfig.sourceDataset,
  };

  // 2. Load the entity's latest pipeline (auto-synthesize if missing)
  let pipeline = db
    .select()
    .from(entityPipeline)
    .where(
      and(
        eq(entityPipeline.entityId, entityId),
        eq(entityPipeline.workspaceId, workspaceId),
        eq(entityPipeline.isLatest, true)
      )
    )
    .get();

  if (!pipeline) {
    const targetEntity = db
      .select()
      .from(entityTable)
      .where(eq(entityTable.id, entityId))
      .get();

    if (!targetEntity) {
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }

    const fieldIds = db
      .select({ id: field.id })
      .from(field)
      .where(eq(field.entityId, entityId))
      .all()
      .map((f) => f.id);

    const hasMappings =
      fieldIds.length > 0 &&
      db
        .select({ id: fieldMapping.id, targetFieldId: fieldMapping.targetFieldId })
        .from(fieldMapping)
        .where(
          and(
            eq(fieldMapping.workspaceId, workspaceId),
            eq(fieldMapping.isLatest, true)
          )
        )
        .all()
        .some((m) => fieldIds.includes(m.targetFieldId));

    if (hasMappings) {
      try {
        synthesizePipelineFromMappings({
          workspaceId,
          entityId,
          entityName: targetEntity.displayName || targetEntity.name,
        });
        pipeline = db
          .select()
          .from(entityPipeline)
          .where(
            and(
              eq(entityPipeline.entityId, entityId),
              eq(entityPipeline.workspaceId, workspaceId),
              eq(entityPipeline.isLatest, true)
            )
          )
          .get();
      } catch (err) {
        console.warn("[sample-data] Auto-synthesis failed:", err);
      }
    }

    if (!pipeline) {
      return NextResponse.json(
        { error: "No pipeline found for this entity", code: "NO_PIPELINE" },
        { status: 404 }
      );
    }
  }

  // Rebuild stale pipelines
  if (pipeline.isStale) {
    try {
      rebuildPipelineYaml(pipeline.id);
      const updated = db
        .select()
        .from(entityPipeline)
        .where(eq(entityPipeline.id, pipeline.id))
        .get();
      if (updated) pipeline = updated;
    } catch (err) {
      console.warn("[sample-data] Rebuild failed, using stale pipeline:", err);
    }
  }

  // 3. Parse columns from YAML
  const columns = parseColumnsFromYaml(pipeline.yamlSpec);
  const pipelineWithCols = {
    ...pipeline,
    structureType: pipeline.structureType as EntityPipelineWithColumns["structureType"],
    sources: pipeline.sources as unknown as EntityPipelineWithColumns["sources"],
    joins: pipeline.joins as unknown as EntityPipelineWithColumns["joins"],
    concat: pipeline.concat as unknown as EntityPipelineWithColumns["concat"],
    columns,
  } as EntityPipelineWithColumns;

  // 4. Filter out null/unmapped columns for display
  const mappedColumns = columns.filter((c) => c.transform !== "null");
  const columnNames = mappedColumns.map((c) => c.target_column);

  const entityName = db
    .select({ name: entityTable.name, displayName: entityTable.displayName })
    .from(entityTable)
    .where(eq(entityTable.id, entityId))
    .get();

  try {
    if (pipelineWithCols.structureType === "assembly" && pipelineWithCols.concat) {
      // Assembly: query each component via its own child entity pipeline.
      // The assembly's sources reference logical staging names (e.g. "borrower_primary")
      // that don't exist in BigQuery. Each child entity's flat pipeline has the real
      // ACDC table references (e.g. "LoanInfo").
      const componentAliases = pipelineWithCols.concat.sources;

      // Load child entities for this assembly
      const childEntities = db
        .select()
        .from(entityTable)
        .where(eq(entityTable.parentEntityId, entityId))
        .all();

      const componentResults = await Promise.allSettled(
        componentAliases.map(async (alias) => {
          const source = pipelineWithCols.sources.find((s) => s.alias === alias);

          // Match child entity by name (alias matches the component entity name)
          const childEntity = childEntities.find(
            (e) => e.name === alias || e.name === source?.name
          );

          // Try to load the child entity's own pipeline for real table references
          let childPipeline: typeof pipeline | undefined;
          if (childEntity) {
            childPipeline = db
              .select()
              .from(entityPipeline)
              .where(
                and(
                  eq(entityPipeline.entityId, childEntity.id),
                  eq(entityPipeline.workspaceId, workspaceId),
                  eq(entityPipeline.isLatest, true)
                )
              )
              .get();
          }

          let tableName: string;

          if (childPipeline) {
            // Use the child entity's flat pipeline → real ACDC table references
            const childColumns = parseColumnsFromYaml(childPipeline.yamlSpec);
            const childWithCols = {
              ...childPipeline,
              structureType: childPipeline.structureType as EntityPipelineWithColumns["structureType"],
              sources: childPipeline.sources as unknown as EntityPipelineWithColumns["sources"],
              joins: childPipeline.joins as unknown as EntityPipelineWithColumns["joins"],
              concat: childPipeline.concat as unknown as EntityPipelineWithColumns["concat"],
              columns: childColumns,
            } as EntityPipelineWithColumns;
            tableName = childPipeline.tableName;

            try {
              const { sql, result, nullifiedColumns } = await executeWithRetry(
                childWithCols, sqlConfig, limit
              );
              return { alias, tableName, sql, result, ...(nullifiedColumns.length > 0 && { nullifiedColumns }) };
            } catch (err) {
              const sql = renderExecutableSql(childWithCols, sqlConfig, limit);
              return {
                alias, tableName, sql,
                result: { rows: [], totalRows: 0, truncated: false },
                error: err instanceof Error ? err.message : String(err),
              };
            }
          } else {
            // Fallback: use assembly's source references (may fail, but shows SQL for debugging)
            const sql = renderComponentSql(pipelineWithCols, alias, sqlConfig, limit);
            tableName = source?.table ?? alias;

            try {
              const result = await runQuery(sqlConfig.projectId, sql, limit);
              return { alias, tableName, sql, result };
            } catch (err) {
              return {
                alias, tableName, sql,
                result: { rows: [], totalRows: 0, truncated: false },
                error: err instanceof Error ? err.message : String(err),
              };
            }
          }
        })
      );

      const components = componentResults.map((r) => {
        if (r.status === "fulfilled") return r.value;
        return {
          alias: "unknown",
          tableName: "unknown",
          sql: "",
          result: { rows: [], totalRows: 0, truncated: false },
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        };
      });

      return NextResponse.json({
        structureType: "assembly" as const,
        entityName: entityName?.displayName || entityName?.name || pipeline.tableName,
        columns: columnNames,
        components,
      });
    } else {
      // Flat: single query with retry on bad column refs
      const { sql, result, nullifiedColumns } = await executeWithRetry(
        pipelineWithCols, sqlConfig, limit
      );

      return NextResponse.json({
        structureType: "flat" as const,
        entityName: entityName?.displayName || entityName?.name || pipeline.tableName,
        sql,
        result,
        columns: columnNames.filter((c) => !nullifiedColumns.includes(c)),
        ...(nullifiedColumns.length > 0 && { nullifiedColumns }),
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Return the SQL for debugging even on error
    let sql = "";
    try {
      sql = renderExecutableSql(pipelineWithCols, sqlConfig, limit);
    } catch { /* ignore */ }

    return NextResponse.json(
      {
        error: `Query failed: ${message}`,
        code: "QUERY_FAILED",
        sql,
      },
      { status: 500 }
    );
  }
});

function parseColumnsFromYaml(yamlSpec: string): PipelineColumn[] {
  try {
    const parsed = yaml.load(yamlSpec) as Record<string, unknown>;
    return (parsed?.columns as PipelineColumn[]) ?? [];
  } catch {
    return [];
  }
}

const MAX_RETRIES = 3;

/**
 * Execute a pipeline query with automatic retry: if BQ reports
 * "Name X not found inside Y", null out the bad columns and retry.
 */
async function executeWithRetry(
  pipeline: EntityPipelineWithColumns,
  sqlConfig: BqSqlConfig,
  limit: number
): Promise<{
  sql: string;
  result: { rows: Record<string, unknown>[]; totalRows: number; truncated: boolean };
  nullifiedColumns: string[];
}> {
  let current = pipeline;
  const allNullified: string[] = [];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const sql = renderExecutableSql(current, sqlConfig, limit);
    try {
      const result = await runQuery(sqlConfig.projectId, sql, limit);
      return { sql, result, nullifiedColumns: allNullified };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const badRefs = parseBadColumnRefs(msg);

      if (badRefs.length === 0 || attempt === MAX_RETRIES) {
        throw err; // Not a column-ref error or out of retries
      }

      const { pipeline: fixed, nullified } = nullifyBadColumns(current, badRefs);
      if (nullified.length === 0) throw err; // Couldn't find the column to nullify
      allNullified.push(...nullified);
      console.warn(`[sample-data] Nullified columns [${nullified.join(", ")}] due to: ${msg}`);
      current = fixed;
    }
  }

  // Should not reach here, but satisfy TS
  throw new Error("Max retries exceeded");
}
