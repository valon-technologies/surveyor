import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { analyticsEvent } from "@/lib/db/schema";

export const POST = withAuth(async (req, _ctx, { workspaceId, userId }) => {
  const body = await req.json();
  const { eventName, fieldMappingId, entityId, sessionId, durationMs, properties } = body;

  if (!eventName || typeof eventName !== "string") {
    return NextResponse.json({ error: "eventName is required" }, { status: 400 });
  }

  await db.insert(analyticsEvent).values({
    workspaceId,
    userId,
    eventName,
    fieldMappingId: fieldMappingId || null,
    entityId: entityId || null,
    sessionId: sessionId || null,
    durationMs: durationMs ?? null,
    properties: properties || null,
  });

  return NextResponse.json({ ok: true });
});
