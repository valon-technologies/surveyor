import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db, withTransaction } from "@/lib/db";
import { transfer, schemaAsset, entity, field } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { parseTransferSourceCSV, parseRequirementCSV } from "@/lib/import/transfer-source-parser";
import { matchRequirementType } from "@/lib/transfer/requirement-matcher";

export const GET = withAuth(async (_req, _ctx, { workspaceId }) => {
  const transfers = await db
    .select()
    .from(transfer)
    .where(eq(transfer.workspaceId, workspaceId))
    .orderBy(desc(transfer.createdAt));

  return NextResponse.json(transfers);
});

export const POST = withAuth(async (req, _ctx, { workspaceId, userId }) => {
  const body = await req.json();
  const { name, clientName, description, sourceFile, requirementCsv, targetSchemaAssetId } = body;

  if (!name || !sourceFile) {
    return NextResponse.json(
      { error: "name and sourceFile are required" },
      { status: 400 },
    );
  }

  try {
    const result = await withTransaction(async (tx) => {
      // 1. Create transfer record with status "importing"
      const [t] = await tx
        .insert(transfer)
        .values({
          workspaceId,
          name,
          clientName: clientName || null,
          description: description || null,
          status: "importing",
          targetSchemaAssetId: targetSchemaAssetId || null,
          createdBy: userId,
        })
        .returning();

      // 2. Create a schemaAsset for the source file
      const [asset] = await tx
        .insert(schemaAsset)
        .values({
          workspaceId,
          name: `${name} Source File`,
          side: "source",
          format: "csv",
          rawContent: sourceFile,
        })
        .returning();

      // 3. Parse the source CSV
      const parsed = parseTransferSourceCSV(sourceFile);

      // 4. Create a single source entity
      const entityName = `${clientName || name}_flat_file`;
      const [ent] = await tx
        .insert(entity)
        .values({
          workspaceId,
          schemaAssetId: asset.id,
          name: entityName,
          displayName: entityName,
          side: "source",
        })
        .returning();

      // 5. Create field records for each source field
      if (parsed.fields.length > 0) {
        await tx.insert(field).values(
          parsed.fields.map((f, idx) => ({
            entityId: ent.id,
            name: f.fieldName,
            displayName: f.fieldName,
            position: f.position,
            sampleValues: f.sampleValue ? [f.sampleValue] : [],
            sortOrder: idx,
          })),
        );
      }

      // 6. If requirementCsv provided, match requirements to target fields
      if (requirementCsv) {
        const reqs = parseRequirementCSV(requirementCsv);

        // Get all target fields in the workspace via target entities
        const targetEntities = await tx
          .select({ id: entity.id, name: entity.name })
          .from(entity)
          .where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "target")));

        for (const te of targetEntities) {
          const targetFields = await tx
            .select({ id: field.id, name: field.name })
            .from(field)
            .where(eq(field.entityId, te.id));

          for (const tf of targetFields) {
            const match = matchRequirementType(te.name, tf.name, reqs.lookup);
            if (match) {
              await tx
                .update(field)
                .set({
                  requirementType: match.requirementType,
                  requirementDetail: match.requirementDetail,
                })
                .where(eq(field.id, tf.id));
            }
          }
        }
      }

      // 7. Link sourceSchemaAssetId on the transfer
      // 8. Update stats
      // 9. Set status to "ready"
      const [updated] = await tx
        .update(transfer)
        .set({
          sourceSchemaAssetId: asset.id,
          stats: {
            totalSourceFields: parsed.totalFields,
          },
          status: "ready",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(transfer.id, t.id))
        .returning();

      return updated;
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}, { requiredRole: "editor" });
