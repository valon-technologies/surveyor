import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userApiKey } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { encrypt } from "@/lib/auth/encryption";

// PUT — replace an API key
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { apiKey } = await req.json();

  if (!apiKey) {
    return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
  }

  const existing = db
    .select()
    .from(userApiKey)
    .where(and(eq(userApiKey.id, id), eq(userApiKey.userId, session.user.id)))
    .get();

  if (!existing) {
    return NextResponse.json({ error: "Key not found" }, { status: 404 });
  }

  const { encryptedKey, iv, authTag } = encrypt(apiKey);
  const keyPrefix = apiKey.slice(0, 8) + "...";

  db.update(userApiKey)
    .set({
      encryptedKey,
      iv,
      authTag,
      keyPrefix,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(userApiKey.id, id))
    .run();

  return NextResponse.json({ id, provider: existing.provider, keyPrefix });
}

// DELETE — remove an API key
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const existing = db
    .select()
    .from(userApiKey)
    .where(and(eq(userApiKey.id, id), eq(userApiKey.userId, session.user.id)))
    .get();

  if (!existing) {
    return NextResponse.json({ error: "Key not found" }, { status: 404 });
  }

  db.delete(userApiKey).where(eq(userApiKey.id, id)).run();

  return NextResponse.json({ success: true });
}
