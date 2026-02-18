import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userApiKey } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { encrypt } from "@/lib/auth/encryption";

// GET — list user's API keys (with prefix only, never the full key)
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const keys = db
    .select({
      id: userApiKey.id,
      provider: userApiKey.provider,
      keyPrefix: userApiKey.keyPrefix,
      createdAt: userApiKey.createdAt,
      updatedAt: userApiKey.updatedAt,
    })
    .from(userApiKey)
    .where(eq(userApiKey.userId, session.user.id))
    .all();

  return NextResponse.json(keys);
}

// POST — store a new API key (encrypted)
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { provider, apiKey } = await req.json();

  if (!provider || !apiKey) {
    return NextResponse.json(
      { error: "Provider and apiKey are required" },
      { status: 400 }
    );
  }

  if (!["claude", "openai"].includes(provider)) {
    return NextResponse.json(
      { error: "Provider must be 'claude' or 'openai'" },
      { status: 400 }
    );
  }

  const { encryptedKey, iv, authTag } = encrypt(apiKey);
  const keyPrefix = apiKey.slice(0, 8) + "...";

  // Upsert: delete existing key for this provider, then insert
  const existing = db
    .select({ id: userApiKey.id })
    .from(userApiKey)
    .where(eq(userApiKey.userId, session.user.id))
    .all()
    .filter((k) => {
      const row = db
        .select({ provider: userApiKey.provider })
        .from(userApiKey)
        .where(eq(userApiKey.id, k.id))
        .get();
      return row?.provider === provider;
    });

  for (const k of existing) {
    db.delete(userApiKey).where(eq(userApiKey.id, k.id)).run();
  }

  const [key] = db
    .insert(userApiKey)
    .values({
      userId: session.user.id,
      provider,
      encryptedKey,
      iv,
      authTag,
      keyPrefix,
    })
    .returning()
    .all();

  return NextResponse.json(
    { id: key.id, provider: key.provider, keyPrefix },
    { status: 201 }
  );
}
