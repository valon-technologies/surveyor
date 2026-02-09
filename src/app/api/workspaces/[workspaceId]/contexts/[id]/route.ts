import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { context } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { updateContextSchema } from "@/lib/validators/context";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string }> }
) {
  const { workspaceId, id } = await params;

  const ctx = db
    .select()
    .from(context)
    .where(and(eq(context.id, id), eq(context.workspaceId, workspaceId)))
    .get();

  if (!ctx) {
    return NextResponse.json({ error: "Context not found" }, { status: 404 });
  }

  return NextResponse.json(ctx);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string }> }
) {
  const { workspaceId, id } = await params;
  const body = await req.json();
  const parsed = updateContextSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const [updated] = db
    .update(context)
    .set({ ...parsed.data, updatedAt: new Date().toISOString() })
    .where(and(eq(context.id, id), eq(context.workspaceId, workspaceId)))
    .returning()
    .all();

  if (!updated) {
    return NextResponse.json({ error: "Context not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string }> }
) {
  const { workspaceId, id } = await params;

  db.delete(context)
    .where(and(eq(context.id, id), eq(context.workspaceId, workspaceId)))
    .run();

  return NextResponse.json({ success: true });
}
