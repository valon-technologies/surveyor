// This route is no longer used. The skills/import endpoint was for the deprecated
// context-as-skill import flow. Use /contexts for context import instead.
import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Deprecated. Use /api/workspaces/{id}/contexts for context import." },
    { status: 410 }
  );
}
