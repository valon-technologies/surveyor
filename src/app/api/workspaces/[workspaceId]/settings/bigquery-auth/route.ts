import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// GET — check ADC status
export const GET = withAuth(async () => {
  try {
    await execFileAsync("gcloud", ["auth", "application-default", "print-access-token"], {
      timeout: 5_000,
    });
    return NextResponse.json({ status: "valid" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const expired = msg.includes("Reauthentication") || msg.includes("refresh");
    return NextResponse.json({
      status: expired ? "expired" : "missing",
      error: msg,
    });
  }
}, { requiredRole: "editor" });

// POST — trigger `gcloud auth application-default login` (opens browser)
export const POST = withAuth(async () => {
  try {
    // Spawn the auth flow — this opens the user's browser.
    // We don't await completion since the OAuth flow is interactive.
    const child = require("child_process").spawn(
      "gcloud",
      ["auth", "application-default", "login"],
      { detached: true, stdio: "ignore" }
    );
    child.unref();

    return NextResponse.json({ ok: true, message: "Browser opened for Google OAuth. Complete the flow to refresh credentials." });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to launch auth flow" },
      { status: 500 }
    );
  }
}, { requiredRole: "editor" });
