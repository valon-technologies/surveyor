/**
 * Identifies VDS system-generated fields that don't need manual mapping.
 * These are auto-populated by the data platform (PKs, FKs, audit timestamps).
 */

/** Exact field names that are always system-generated */
const SYSTEM_EXACT = new Set([
  "id",
  "created_at",
  "updated_at",
  "deleted_at",
]);

/**
 * Returns true if a field name looks system-generated (PK, FK, or audit timestamp).
 * Only applies to unmapped fields — if a reviewer has already mapped/accepted it, respect that.
 */
export function isSystemField(fieldName: string): boolean {
  if (SYSTEM_EXACT.has(fieldName)) return true;
  // FK suffixes: _id, _sid
  if (/(_id|_sid)$/.test(fieldName)) return true;
  return false;
}
