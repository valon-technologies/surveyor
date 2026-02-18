import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { schemaAsset, entity, field } from "@/lib/db/schema";
import { eq, and, count } from "drizzle-orm";
import { createSchemaAssetSchema } from "@/lib/validators/schema";
import { parseCSVSchema, type ParsedEntity } from "@/lib/import/schema-parser";
import { parsePDFSchema } from "@/lib/import/pdf-schema-parser";
import { resolveProvider } from "@/lib/generation/provider-resolver";

export const GET = withAuth(async (_req, ctx, { workspaceId }) => {
  // Exclude rawContent from list response (can be huge)
  const assets = db
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
    .orderBy(schemaAsset.createdAt)
    .all();

  // Get entity counts per asset
  const result = assets.map((asset) => {
    const entityCount = db
      .select({ cnt: count() })
      .from(entity)
      .where(eq(entity.schemaAssetId, asset.id))
      .get();

    return { ...asset, entityCount: entityCount?.cnt || 0 };
  });

  return NextResponse.json(result);
});

/** Insert parsed entities + fields into the DB for a given schema asset. */
function insertEntities(
  parsedEntities: ParsedEntity[],
  assetId: string,
  workspaceId: string,
  side: string
) {
  for (let i = 0; i < parsedEntities.length; i++) {
    const pe = parsedEntities[i];

    const [ent] = db
      .insert(entity)
      .values({
        workspaceId,
        schemaAssetId: assetId,
        name: pe.name,
        displayName: pe.displayName,
        side,
        description: pe.description,
        sortOrder: i,
      })
      .returning()
      .all();

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

      db.insert(field).values(fieldValues).run();
    }
  }
}

export const POST = withAuth(async (req, ctx, { workspaceId, userId }) => {
  const body = await req.json();
  const parsed = createSchemaAssetSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const input = parsed.data;

  // Create schema asset
  const [asset] = db
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
    .returning()
    .all();

  // Parse CSV into entities + fields
  if (input.format === "csv" || !input.format) {
    try {
      const parsedEntities = parseCSVSchema(input.rawContent, input.name, {
        deduplicateFields: input.side === "target",
      });
      insertEntities(parsedEntities, asset.id, workspaceId, input.side);
    } catch (err) {
      // Still return the asset even if parsing fails — rawContent is saved
      return NextResponse.json(
        { ...asset, parseError: (err as Error).message },
        { status: 201 }
      );
    }
  }

  // Parse PDF via Claude extraction
  else if (input.format === "pdf") {
    try {
      const { provider } = resolveProvider(userId, "claude");
      const result = await parsePDFSchema(input.rawContent, input.name, provider);

      // Replace base64 rawContent with readable extracted text
      db.update(schemaAsset)
        .set({
          rawContent: result.extractedText,
          metadata: {
            ...(asset.metadata as Record<string, unknown> | null),
            pdfExtraction: {
              inputTokens: result.usage.inputTokens,
              outputTokens: result.usage.outputTokens,
              entityCount: result.entities.length,
              fieldCount: result.entities.reduce((sum, e) => sum + e.fields.length, 0),
            },
          },
        })
        .where(eq(schemaAsset.id, asset.id))
        .run();

      insertEntities(result.entities, asset.id, workspaceId, input.side);
    } catch (err) {
      return NextResponse.json(
        { ...asset, parseError: (err as Error).message },
        { status: 201 }
      );
    }
  }

  return NextResponse.json(asset, { status: 201 });
}, { requiredRole: "editor" });
