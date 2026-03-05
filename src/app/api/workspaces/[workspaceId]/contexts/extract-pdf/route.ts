import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { resolveProvider } from "@/lib/generation/provider-resolver";
import { extractPDFText } from "@/lib/import/pdf-text-extractor";

export const POST = withAuth(async (req, _ctx, { userId }) => {
  const body = await req.json();
  const { base64Content, name } = body as { base64Content: string; name: string };

  if (!base64Content) {
    return NextResponse.json({ error: "base64Content is required" }, { status: 400 });
  }

  const { provider } = await resolveProvider(userId, "claude");
  const result = await extractPDFText(base64Content, name || "document.pdf", provider);

  return NextResponse.json({ content: result.content });
}, { requiredRole: "editor" });
