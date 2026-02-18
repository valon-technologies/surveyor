import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { testConnection } from "@/lib/bigquery/gestalt-client";

// POST — test BQ connection via Gestalt
export const POST = withAuth(async (req, _ctx, { }) => {
  const { projectId, sourceDataset } = await req.json();

  if (!projectId || !sourceDataset) {
    return NextResponse.json(
      { success: false, error: "Project ID and Source Dataset are required" },
      { status: 400 }
    );
  }

  const result = await testConnection(projectId, sourceDataset);
  return NextResponse.json(result);
}, { requiredRole: "editor" });
