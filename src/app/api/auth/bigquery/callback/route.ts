import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userBigqueryToken } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { encrypt } from "@/lib/auth/encryption";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/auth/signin", process.env.NEXTAUTH_URL));
  }

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const storedState = req.cookies.get("bq_oauth_state")?.value;

  // Clear state cookie early
  const clearCookie = (res: NextResponse) => {
    res.cookies.set("bq_oauth_state", "", { maxAge: 0, path: "/" });
    return res;
  };

  if (error) {
    const res = NextResponse.redirect(
      new URL(`/settings/bigquery?bq_error=${encodeURIComponent(error)}`, process.env.NEXTAUTH_URL)
    );
    return clearCookie(res);
  }

  if (!code || !state || state !== storedState) {
    const res = NextResponse.redirect(
      new URL("/settings/bigquery?bq_error=invalid_state", process.env.NEXTAUTH_URL)
    );
    return clearCookie(res);
  }

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${process.env.NEXTAUTH_URL}/api/auth/bigquery/callback`,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    console.error("BQ token exchange failed:", err);
    const res = NextResponse.redirect(
      new URL("/settings/bigquery?bq_error=token_exchange_failed", process.env.NEXTAUTH_URL)
    );
    return clearCookie(res);
  }

  const tokens = await tokenRes.json();
  const refreshToken = tokens.refresh_token;

  if (!refreshToken) {
    const res = NextResponse.redirect(
      new URL("/settings/bigquery?bq_error=no_refresh_token", process.env.NEXTAUTH_URL)
    );
    return clearCookie(res);
  }

  // Fetch user email from Google
  let email: string | null = null;
  if (tokens.access_token) {
    try {
      const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (userInfoRes.ok) {
        const info = await userInfoRes.json();
        email = info.email || null;
      }
    } catch {
      // Non-critical — proceed without email
    }
  }

  // Encrypt and upsert
  const { encryptedKey, iv, authTag } = encrypt(refreshToken);
  const userId = session.user.id;

  // Delete existing token for this user
  db.delete(userBigqueryToken)
    .where(eq(userBigqueryToken.userId, userId))
    .run();

  db.insert(userBigqueryToken)
    .values({
      userId,
      email,
      encryptedRefreshToken: encryptedKey,
      iv,
      authTag,
      scope: tokens.scope || null,
    })
    .run();

  const res = NextResponse.redirect(
    new URL("/settings/bigquery?bq_connected=1", process.env.NEXTAUTH_URL)
  );
  return clearCookie(res);
}
