/**
 * In-memory prefetch cache for BigQuery baseline data.
 * Ephemeral process-level caching — does not survive restarts.
 */

const TTL_MS = 30 * 60 * 1000; // 30 minutes

interface CacheEntry {
  data: unknown;
  error?: string;
  fetchedAt: number;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function buildKey(
  projectId: string,
  dataset: string,
  table: string,
  type: string,
  field?: string
): string {
  const parts = [projectId, dataset, table, type];
  if (field) parts.push(field);
  return parts.join(":");
}

export function getCached(key: string): CacheEntry | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry;
}

export function setCached(key: string, data: unknown, error?: string): void {
  const now = Date.now();
  cache.set(key, {
    data,
    error,
    fetchedAt: now,
    expiresAt: now + TTL_MS,
  });
}

export interface BaselineData {
  tableName: string;
  rowCount: number;
  sampleRows: Record<string, unknown>[];
  fieldProfile?: {
    fieldName: string;
    nullCount?: number;
    totalRows?: number;
    distinctValues?: unknown[];
  };
}

/**
 * Check whether all baseline queries for a given table (+ optional field) are cached.
 */
export function isBaselineReady(
  projectId: string,
  dataset: string,
  table: string,
  field?: string
): boolean {
  const schemaKey = buildKey(projectId, dataset, table, "schema");
  const sampleKey = buildKey(projectId, dataset, table, "sample");
  if (!getCached(schemaKey) || !getCached(sampleKey)) return false;

  if (field) {
    const nullKey = buildKey(projectId, dataset, table, "nullrate", field);
    const distinctKey = buildKey(projectId, dataset, table, "distinct", field);
    if (!getCached(nullKey) || !getCached(distinctKey)) return false;
  }

  return true;
}

/**
 * Assemble cached baseline data into a structured object for prompt injection.
 * Returns null if required data is missing.
 */
export function getBaselineData(
  projectId: string,
  dataset: string,
  table: string,
  field?: string
): BaselineData | null {
  const schemaEntry = getCached(buildKey(projectId, dataset, table, "schema"));
  const sampleEntry = getCached(buildKey(projectId, dataset, table, "sample"));

  if (!schemaEntry || !sampleEntry) return null;
  // Allow entries that have errors — we just won't include that piece
  if (schemaEntry.error && sampleEntry.error) return null;

  const schema = schemaEntry.data as { num_rows?: number } | null;
  const sample = sampleEntry.data as { rows?: Record<string, unknown>[] } | null;

  const result: BaselineData = {
    tableName: table,
    rowCount: schema?.num_rows ?? 0,
    sampleRows: sample?.rows ?? [],
  };

  if (field) {
    const nullEntry = getCached(buildKey(projectId, dataset, table, "nullrate", field));
    const distinctEntry = getCached(buildKey(projectId, dataset, table, "distinct", field));

    if (nullEntry || distinctEntry) {
      const nullData = nullEntry?.data as { rows?: Record<string, unknown>[] } | null;
      const distinctData = distinctEntry?.data as { rows?: Record<string, unknown>[] } | null;

      result.fieldProfile = {
        fieldName: field,
        nullCount: nullData?.rows?.[0]
          ? Number(nullData.rows[0].null_count ?? 0)
          : undefined,
        totalRows: nullData?.rows?.[0]
          ? Number(nullData.rows[0].total_rows ?? 0)
          : undefined,
        distinctValues: distinctData?.rows?.map((r) => r.val) ?? undefined,
      };
    }
  }

  return result;
}
