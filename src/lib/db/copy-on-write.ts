import { db, withTransaction } from ".";
import { fieldMapping, entityPipeline } from "./schema";
import { eq, and } from "drizzle-orm";

type FieldMappingInsert = typeof fieldMapping.$inferInsert;
type FieldMappingSelect = typeof fieldMapping.$inferSelect;
type EntityPipelineInsert = typeof entityPipeline.$inferInsert;

/**
 * Atomically create a new field mapping version, marking the old version as not-latest.
 * The mark-old + insert-new runs inside a transaction to prevent
 * two concurrent writers from both creating isLatest=true versions.
 */
export async function createMappingVersion(
  existingId: string,
  newValues: FieldMappingInsert,
): Promise<FieldMappingSelect> {
  return await withTransaction(async (tx) => {
    await tx.update(fieldMapping)
      .set({ isLatest: false, updatedAt: new Date().toISOString() })
      .where(eq(fieldMapping.id, existingId));

    const [newVersion] = await tx
      .insert(fieldMapping)
      .values({ ...newValues, isLatest: true })
      .returning();

    return newVersion;
  });
}

/**
 * Atomically create a new field mapping version by target field ID.
 * Marks ALL existing latest mappings for the target field as not-latest.
 * Used by bulk operations where the existing mapping may not be known by ID.
 */
export async function createMappingVersionByTargetField(
  targetFieldId: string,
  newValues: FieldMappingInsert,
): Promise<FieldMappingSelect> {
  return await withTransaction(async (tx) => {
    await tx.update(fieldMapping)
      .set({ isLatest: false })
      .where(
        and(
          eq(fieldMapping.targetFieldId, targetFieldId),
          eq(fieldMapping.isLatest, true),
        ),
      );

    const [newVersion] = await tx
      .insert(fieldMapping)
      .values({ ...newValues, isLatest: true })
      .returning();

    return newVersion;
  });
}

/**
 * Atomically create a new entity pipeline version, marking the old version as not-latest.
 */
export async function createPipelineVersion(
  existingId: string,
  newValues: EntityPipelineInsert,
): Promise<void> {
  await withTransaction(async (tx) => {
    await tx.update(entityPipeline)
      .set({ isLatest: false, updatedAt: new Date().toISOString() })
      .where(eq(entityPipeline.id, existingId));

    await tx.insert(entityPipeline)
      .values({ ...newValues, isLatest: true });
  });
}
