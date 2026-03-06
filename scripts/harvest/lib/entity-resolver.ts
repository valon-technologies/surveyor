/**
 * Entity resolver: loads VDS target entity/field names from Surveyor DB
 * and provides fuzzy matching for harvest claim extraction.
 */

interface EntityRecord {
  id: string;
  name: string;
  displayName: string | null;
}

interface FieldRecord {
  entityId: string;
  name: string;
  displayName: string | null;
}

let cachedEntities: EntityRecord[] | null = null;
let cachedFields: FieldRecord[] | null = null;

function normalize(s: string): string {
  return s.replace(/[\s_\-]+/g, "").toLowerCase();
}

async function loadFromDb(): Promise<void> {
  if (cachedEntities && cachedFields) return;

  const { db } = await import("../../../src/lib/db");
  const { entity, field } = await import("../../../src/lib/db/schema");
  const { eq } = await import("drizzle-orm");

  cachedEntities = await db
    .select({
      id: entity.id,
      name: entity.name,
      displayName: entity.displayName,
    })
    .from(entity)
    .where(eq(entity.side, "target"));

  const entityIds = new Set(cachedEntities.map((e) => e.id));

  const allFields = await db
    .select({
      entityId: field.entityId,
      name: field.name,
      displayName: field.displayName,
    })
    .from(field);

  // Only keep fields belonging to target entities
  cachedFields = allFields.filter((f) => entityIds.has(f.entityId));
}

/**
 * Resolve a mention to the best-matching target entity name.
 * Returns the canonical entity name or null if no match.
 */
export async function resolveEntity(mention: string): Promise<string | null> {
  await loadFromDb();
  const norm = normalize(mention);

  // Exact normalized match on name or displayName
  for (const e of cachedEntities!) {
    if (normalize(e.name) === norm) return e.name;
    if (e.displayName && normalize(e.displayName) === norm) return e.name;
  }

  // Substring match: mention contained in name or vice versa
  for (const e of cachedEntities!) {
    const eName = normalize(e.name);
    if (eName.includes(norm) || norm.includes(eName)) return e.name;
    if (e.displayName) {
      const eDisplay = normalize(e.displayName);
      if (eDisplay.includes(norm) || norm.includes(eDisplay)) return e.name;
    }
  }

  return null;
}

/**
 * Resolve a field mention within an entity context.
 * Returns the canonical field name or null if no match.
 */
export async function resolveField(
  entityHint: string,
  fieldMention: string,
): Promise<string | null> {
  await loadFromDb();
  const resolvedEntity = await resolveEntity(entityHint);
  if (!resolvedEntity) return null;

  const entityId = cachedEntities!.find((e) => e.name === resolvedEntity)?.id;
  if (!entityId) return null;

  const entityFields = cachedFields!.filter((f) => f.entityId === entityId);
  const norm = normalize(fieldMention);

  // Exact normalized match
  for (const f of entityFields) {
    if (normalize(f.name) === norm) return f.name;
    if (f.displayName && normalize(f.displayName) === norm) return f.name;
  }

  // Substring match
  for (const f of entityFields) {
    const fName = normalize(f.name);
    if (fName.includes(norm) || norm.includes(fName)) return f.name;
    if (f.displayName) {
      const fDisplay = normalize(f.displayName);
      if (fDisplay.includes(norm) || norm.includes(fDisplay)) return f.name;
    }
  }

  return null;
}

/**
 * Get all target entity names for use in LLM prompts.
 */
export async function getEntityNames(): Promise<string[]> {
  await loadFromDb();
  return cachedEntities!.map((e) => e.name);
}
