import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { schemaAsset, entity, field } from "@/lib/db/schema";
import { eq, and, count } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string }> }
) {
  const { workspaceId, id } = await params;

  const asset = db
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
    .where(and(eq(schemaAsset.id, id), eq(schemaAsset.workspaceId, workspaceId)))
    .get();

  if (!asset) {
    return NextResponse.json({ error: "Schema asset not found" }, { status: 404 });
  }

  // Get entities with field counts
  const entities = db
    .select()
    .from(entity)
    .where(eq(entity.schemaAssetId, id))
    .orderBy(entity.sortOrder)
    .all();

  const entitiesWithFields = entities.map((ent) => {
    const fieldCount = db
      .select({ cnt: count() })
      .from(field)
      .where(eq(field.entityId, ent.id))
      .get();

    return { ...ent, fieldCount: fieldCount?.cnt || 0 };
  });

  return NextResponse.json({ ...asset, entities: entitiesWithFields });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string }> }
) {
  const { workspaceId, id } = await params;

  db.delete(schemaAsset)
    .where(and(eq(schemaAsset.id, id), eq(schemaAsset.workspaceId, workspaceId)))
    .run();

  return NextResponse.json({ success: true });
}
