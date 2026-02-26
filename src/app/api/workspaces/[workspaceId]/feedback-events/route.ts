import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { feedbackEvent } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";

export const GET = withAuth(async (req, ctx, { workspaceId }) => {
  const url = new URL(req.url);
  const entityId = url.searchParams.get("entityId");

  if (!entityId) {
    return NextResponse.json({ error: "entityId required" }, { status: 400 });
  }

  const events = db
    .select()
    .from(feedbackEvent)
    .where(
      and(
        eq(feedbackEvent.workspaceId, workspaceId),
        eq(feedbackEvent.entityId, entityId),
      )
    )
    .orderBy(desc(feedbackEvent.createdAt))
    .limit(200)
    .all();

  return NextResponse.json({ events });
});
