import { db, withTransaction } from ".";
import { fieldMapping, entityPipeline } from "./schema";
import { eq, and } from "drizzle-orm";

type FieldMappingInsert = typeof fieldMapping.$inferInsert;
type FieldMappingSelect = typeof fieldMapping.$inferSelect;
type EntityPipelineInsert = typeof entityPipeline.$inferInsert;

/**
 * Atomically create a new field mapping version, marking the old version as not-latest.
 * The mark-old + insert-new runs inside an IMMEDIATE transaction to prevent
 * two concurrent writers from both creating isLatest=true versions.
 */
export function createMappingVersion(
  existingId: string,
  newValues: FieldMappingInsert,
): FieldMappingSelect {
  return withTransaction(() => {
    db.update(fieldMapping)
      .set({ isLatest: false, updatedAt: new Date().toISOString() })
      .where(eq(fieldMapping.id, existingId))
      .run();

    const [newVersion] = db
      .insert(fieldMapping)
      .values({ ...newValues, isLatest: true })
      .returning()
      .all();

    return newVersion;
  });
}

/**
 * Atomically create a new field mapping version by target field ID.
 * Marks ALL existing latest mappings for the target field as not-latest.
 * Used by bulk operations where the existing mapping may not be known by ID.
 */
export function createMappingVersionByTargetField(
  targetFieldId: string,
  newValues: FieldMappingInsert,
): FieldMappingSelect {
  return withTransaction(() => {
    db.update(fieldMapping)
      .set({ isLatest: false })
      .where(
        and(
          eq(fieldMapping.targetFieldId, targetFieldId),
          eq(fieldMapping.isLatest, true),
        ),
      )
      .run();

    const [newVersion] = db
      .insert(fieldMapping)
      .values({ ...newValues, isLatest: true })
      .returning()
      .all();

    return newVersion;
  });
}

/**
 * Atomically create a new entity pipeline version, marking the old version as not-latest.
 */
export function createPipelineVersion(
  existingId: string,
  newValues: EntityPipelineInsert,
): void {
  withTransaction(() => {
    db.update(entityPipeline)
      .set({ isLatest: false, updatedAt: new Date().toISOString() })
      .where(eq(entityPipeline.id, existingId))
      .run();

    db.insert(entityPipeline)
      .values({ ...newValues, isLatest: true })
      .run();
  });
}
