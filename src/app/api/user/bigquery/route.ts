import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userBigqueryToken } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// GET — check if user has BQ token connected
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = db
    .select({
      email: userBigqueryToken.email,
      createdAt: userBigqueryToken.createdAt,
    })
    .from(userBigqueryToken)
    .where(eq(userBigqueryToken.userId, session.user.id))
    .get();

  if (!token) {
    return NextResponse.json({ connected: false });
  }

  return NextResponse.json({
    connected: true,
    email: token.email,
    createdAt: token.createdAt,
  });
}

// DELETE — disconnect BQ (remove token)
export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  db.delete(userBigqueryToken)
    .where(eq(userBigqueryToken.userId, session.user.id))
    .run();

  return NextResponse.json({ disconnected: true });
}
