/**
 * Background prefetch runner for BigQuery baseline data.
 * Fires all baseline queries in parallel and writes results to the prefetch cache.
 */

import type { BigQueryConfig } from "@/types/workspace";
import { getTableSchema, runQuery } from "./gestalt-client";
import { buildKey, getCached, setCached } from "./prefetch-cache";

export interface PrefetchParams {
  bqConfig: BigQueryConfig;
  sourceEntityName: string;
  sourceFieldName?: string;
}

/**
 * Run baseline BQ queries in parallel, writing each result to cache.
 * Best-effort — silently swallows errors per query.
 * Skips queries that are already cached.
 */
export async function runBaselinePrefetch(params: PrefetchParams): Promise<void> {
  const { bqConfig, sourceEntityName, sourceFieldName } = params;
  const { projectId, sourceDataset } = bqConfig;
  const table = sourceEntityName;

  const promises: Promise<void>[] = [];

  // 1. Table schema (via Gestalt)
  const schemaKey = buildKey(projectId, sourceDataset, table, "schema");
  if (!getCached(schemaKey)) {
    promises.push(
      getTableSchema(projectId, sourceDataset, table)
        .then((data) => setCached(schemaKey, data))
        .catch((err) => setCached(schemaKey, null, err instanceof Error ? err.message : "Schema fetch failed"))
    );
  }

  // 2. Sample rows
  const sampleKey = buildKey(projectId, sourceDataset, table, "sample");
  if (!getCached(sampleKey)) {
    const sql = `SELECT * FROM \`${projectId}.${sourceDataset}.${table}\` LIMIT 5`;
    promises.push(
      runQuery(projectId, sql, 5)
        .then((data) => setCached(sampleKey, data))
        .catch((err) => setCached(sampleKey, null, err instanceof Error ? err.message : "Sample query failed"))
    );
  }

  // 3 + 4. Field-specific queries (only when source field is known)
  if (sourceFieldName) {
    const nullKey = buildKey(projectId, sourceDataset, table, "nullrate", sourceFieldName);
    if (!getCached(nullKey)) {
      const sql = `SELECT COUNTIF(${sourceFieldName} IS NULL) as null_count, COUNT(*) as total_rows FROM \`${projectId}.${sourceDataset}.${table}\``;
      promises.push(
        runQuery(projectId, sql, 1)
          .then((data) => setCached(nullKey, data))
          .catch((err) => setCached(nullKey, null, err instanceof Error ? err.message : "Null rate query failed"))
      );
    }

    const distinctKey = buildKey(projectId, sourceDataset, table, "distinct", sourceFieldName);
    if (!getCached(distinctKey)) {
      const sql = `SELECT DISTINCT ${sourceFieldName} as val FROM \`${projectId}.${sourceDataset}.${table}\` WHERE ${sourceFieldName} IS NOT NULL ORDER BY val LIMIT 20`;
      promises.push(
        runQuery(projectId, sql, 20)
          .then((data) => setCached(distinctKey, data))
          .catch((err) => setCached(distinctKey, null, err instanceof Error ? err.message : "Distinct query failed"))
      );
    }
  }

  await Promise.allSettled(promises);
}
