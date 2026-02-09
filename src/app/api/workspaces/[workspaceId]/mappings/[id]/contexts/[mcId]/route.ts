import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { mappingContext } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string; mcId: string }> }
) {
  const { mcId } = await params;

  db.delete(mappingContext).where(eq(mappingContext.id, mcId)).run();

  return NextResponse.json({ success: true });
}
