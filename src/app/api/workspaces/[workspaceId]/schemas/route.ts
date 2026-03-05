import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db, withTransaction } from "@/lib/db";
import { schemaAsset, entity, field } from "@/lib/db/schema";
import { eq, and, count, isNull } from "drizzle-orm";
import { createSchemaAssetSchema } from "@/lib/validators/schema";
import { parseCSVSchema, type ParsedEntity } from "@/lib/import/schema-parser";
import { parsePDFSchema } from "@/lib/import/pdf-schema-parser";
import { resolveProvider } from "@/lib/generation/provider-resolver";
import { markScaffoldsStale } from "@/lib/generation/scaffolding";
import { emitSignal } from "@/lib/generation/skill-signals";

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
    .orderBy(schemaAsset.createdAt)
    ;

  // Get top-level entity counts per asset (exclude child/component entities)
  const result = await Promise.all(assets.map(async (asset) => {
    const entityCount = (await db
      .select({ cnt: count() })
      .from(entity)
      .where(and(eq(entity.schemaAssetId, asset.id), isNull(entity.parentEntityId)))
      )[0];

    return { ...asset, entityCount: entityCount?.cnt || 0 };
  }));

  return NextResponse.json(result);
});

/** Insert parsed entities + fields into the DB for a given schema asset. */
async function insertEntities(
  parsedEntities: ParsedEntity[],
  assetId: string,
  workspaceId: string,
  side: string
) {
  for (let i = 0; i < parsedEntities.length; i++) {
    const pe = parsedEntities[i];

    const [ent] = await db
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
      ;

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
}

export const POST = withAuth(async (req, ctx, { workspaceId, userId }) => {
  const body = await req.json();
  const parsed = createSchemaAssetSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const input = parsed.data;

  let asset: typeof schemaAsset.$inferSelect;

  // Parse CSV into entities + fields
  if (input.format === "csv" || !input.format) {
    try {
      const parsedEntities = parseCSVSchema(input.rawContent, input.name, {
        deduplicateFields: input.side === "target",
      });

      // Transaction: create asset + insert all entities/fields atomically
      asset = await withTransaction(async () => {
        const [a] = await db
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
          ;

        await insertEntities(parsedEntities, a.id, workspaceId, input.side);
        return a;
      });
    } catch (err) {
      // Parsing failed — still save the asset with rawContent
      const [fallbackAsset] = await db
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
        ;

      return NextResponse.json(
        { ...fallbackAsset, parseError: (err as Error).message },
        { status: 201 },
      );
    }
  }

  // Parse PDF via Claude extraction (async — can't be in sync transaction)
  else if (input.format === "pdf") {
    [asset] = await db
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
      ;

    try {
      const { provider } = await resolveProvider(userId, "claude");
      const result = await parsePDFSchema(input.rawContent, input.name, provider);

      // Replace base64 rawContent with readable extracted text
      await db.update(schemaAsset)
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
        ;

      await insertEntities(result.entities, asset.id, workspaceId, input.side);
    } catch (err) {
      return NextResponse.json(
        { ...asset, parseError: (err as Error).message },
        { status: 201 },
      );
    }
  } else {
    // Unknown format — just create the asset
    [asset] = await db
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
      ;
  }

  // Mark all scaffolds as stale since source/target schemas changed
  try {
    markScaffoldsStale(workspaceId);
    emitSignal({
      workspaceId,
      signalType: "schema_change",
      summary: `Schema "${input.name}" (${input.side}) imported/updated`,
      sourceId: asset.id,
      sourceType: "schema_asset",
    });
  } catch {
    // Non-critical — scaffolds will be regenerated on next batch run
  }

  return NextResponse.json(asset, { status: 201 });
}, { requiredRole: "editor" });
