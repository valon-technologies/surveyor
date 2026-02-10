import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { BigQuery } from "@google-cloud/bigquery";
import { db } from "@/lib/db";
import { userBigqueryToken } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { decrypt } from "@/lib/auth/encryption";

// POST — test BQ connection using OAuth credentials (or ADC fallback)
export const POST = withAuth(async (req, _ctx, { userId }) => {
  const { projectId, sourceDataset } = await req.json();

  if (!projectId || !sourceDataset) {
    return NextResponse.json(
      { success: false, error: "Project ID and Source Dataset are required" },
      { status: 400 }
    );
  }

  // Load user's BQ OAuth token
  const bqToken = db
    .select()
    .from(userBigqueryToken)
    .where(eq(userBigqueryToken.userId, userId))
    .get();

  const bqOptions: ConstructorParameters<typeof BigQuery>[0] = { projectId };

  if (bqToken) {
    bqOptions.credentials = {
      type: "authorized_user",
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: decrypt(bqToken.encryptedRefreshToken, bqToken.iv, bqToken.authTag),
    };
  } else if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return NextResponse.json({
      success: false,
      error: "Connect your Google account first. Go to Settings > BigQuery and click \"Connect BigQuery\".",
    });
  }

  try {
    const bq = new BigQuery(bqOptions);

    // Verify the dataset exists by querying INFORMATION_SCHEMA
    const [rows] = await bq.query({
      query: `SELECT schema_name FROM \`${projectId}\`.INFORMATION_SCHEMA.SCHEMATA WHERE schema_name = @dataset`,
      params: { dataset: sourceDataset },
    });

    if (rows.length === 0) {
      return NextResponse.json({
        success: false,
        error: `Dataset "${sourceDataset}" not found in project "${projectId}"`,
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: message });
  }
}, { requiredRole: "editor" });
