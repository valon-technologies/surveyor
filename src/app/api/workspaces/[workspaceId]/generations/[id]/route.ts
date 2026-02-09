import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generation } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string }> }
) {
  const { workspaceId, id } = await params;

  const gen = db
    .select()
    .from(generation)
    .where(and(eq(generation.id, id), eq(generation.workspaceId, workspaceId)))
    .get();

  if (!gen) {
    return NextResponse.json({ error: "Generation not found" }, { status: 404 });
  }

  return NextResponse.json(gen);
}
