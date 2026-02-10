import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { schemaAsset, entity, field } from "@/lib/db/schema";
import { eq, and, count } from "drizzle-orm";
import { createSchemaAssetSchema } from "@/lib/validators/schema";
import { parseCSVSchema } from "@/lib/import/schema-parser";

export const GET = withAuth(async (_req, ctx, { workspaceId }) => {
  // Exclude rawContent from list response (can be huge)
  const assets = await db
    .select({
      id: schemaAsset.id,
      workspaceId: schemaAsset.workspaceId,
      name: schemaAsset.name,
      side: schemaAsset.side,
      description: schemaAsset.description,
      sourceFile: schemaAsset.sourceFile,
      format: schemaAsset.format,
      metadata: schemaAsset.metadata,
      createdAt: schemaAsset.createdAt,
      updatedAt: schemaAsset.updatedAt,
    })
    .from(schemaAsset)
    .where(eq(schemaAsset.workspaceId, workspaceId))
    .orderBy(schemaAsset.createdAt);

  // Get entity counts per asset
  const result = await Promise.all(assets.map(async (asset) => {
    const entityCount = (await db
      .select({ cnt: count() })
      .from(entity)
      .where(eq(entity.schemaAssetId, asset.id)))[0];

    return { ...asset, entityCount: entityCount?.cnt || 0 };
  }));

  return NextResponse.json(result);
});

export const POST = withAuth(async (req, ctx, { workspaceId }) => {
  const body = await req.json();
  const parsed = createSchemaAssetSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const input = parsed.data;

  // Create schema asset
  const [asset] = await db
    .insert(schemaAsset)
    .values({
      workspaceId,
      name: input.name,
      side: input.side,
      description: input.description,
      sourceFile: input.sourceFile,
      format: input.format,
      rawContent: input.rawContent,
    })
    .returning();

  // Parse CSV into entities + fields
  if (input.format === "csv" || !input.format) {
    try {
      const parsedEntities = parseCSVSchema(input.rawContent, input.name, {
        deduplicateFields: input.side === "target",
      });

      for (let i = 0; i < parsedEntities.length; i++) {
        const pe = parsedEntities[i];

        const [ent] = await db
          .insert(entity)
          .values({
            workspaceId,
            schemaAssetId: asset.id,
            name: pe.name,
            displayName: pe.displayName,
            side: input.side,
            description: pe.description,
            sortOrder: i,
          })
          .returning();

        if (pe.fields.length > 0) {
          const fieldValues = pe.fields.map((f, j) => ({
            entityId: ent.id,
            name: f.name,
            displayName: f.displayName,
            dataType: f.dataType,
            isRequired: f.isRequired ?? false,
            isKey: f.isKey ?? false,
            description: f.description,
            milestone: f.milestone,
            sampleValues: f.sampleValues,
            enumValues: f.enumValues,
            sortOrder: j,
          }));

          await db.insert(field).values(fieldValues);
        }
      }
    } catch (err) {
      // Still return the asset even if parsing fails — rawContent is saved
      return NextResponse.json(
        { ...asset, parseError: (err as Error).message },
        { status: 201 }
      );
    }
  }

  return NextResponse.json(asset, { status: 201 });
}, { requiredRole: "editor" });
