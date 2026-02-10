import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { chatSession, chatMessage } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export const GET = withAuth(async (req, ctx, { workspaceId }) => {
  const params = await ctx.params;
  const sessionId = params.sessionId;

  const session = (await db
    .select()
    .from(chatSession)
    .where(
      and(
        eq(chatSession.id, sessionId),
        eq(chatSession.workspaceId, workspaceId)
      )
    ))[0];

  if (!session) {
    return NextResponse.json(
      { error: "Chat session not found" },
      { status: 404 }
    );
  }

  const messages = await db
    .select()
    .from(chatMessage)
    .where(eq(chatMessage.sessionId, sessionId))
    .orderBy(chatMessage.createdAt);

  return NextResponse.json({ ...session, messages });
});
