/**
 * GET  /api/user/profile  — fetch current user's profile (including domains)
 * PATCH /api/user/profile — update mutable profile fields (name, domains)
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { FIELD_DOMAINS } from "@/lib/constants";
import type { FieldDomain } from "@/lib/constants";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = (await db
    .select({
      id:      user.id,
      name:    user.name,
      email:   user.email,
      image:   user.image,
      domains: user.domains,
    })
    .from(user)
    .where(eq(user.id, session.user.id))
    )[0];

  if (!profile) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json(profile);
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const updates: { name?: string; domains?: FieldDomain[] } = {};

  if (typeof body.name === "string") {
    updates.name = body.name.trim() || undefined;
  }

  if (Array.isArray(body.domains)) {
    const invalid = body.domains.filter(
      (d: unknown) => typeof d !== "string" || !FIELD_DOMAINS.includes(d as FieldDomain)
    );
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: `Invalid domain(s): ${invalid.join(", ")}` },
        { status: 400 }
      );
    }
    // Empty array means "no preference" — store as null
    updates.domains = body.domains.length > 0 ? body.domains : [];
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No updatable fields provided" }, { status: 400 });
  }

  await db.update(user)
    .set({ ...updates, updatedAt: new Date().toISOString() })
    .where(eq(user.id, session.user.id))
    ;

  const updated = (await db
    .select({ id: user.id, name: user.name, email: user.email, domains: user.domains })
    .from(user)
    .where(eq(user.id, session.user.id))
    )[0];

  return NextResponse.json(updated);
}
