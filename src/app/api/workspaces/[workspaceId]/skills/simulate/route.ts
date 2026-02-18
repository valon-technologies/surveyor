import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { assembleContext } from "@/lib/generation/context-assembler";

const UNTRIMMED_BUDGET = 999_999;

export const GET = withAuth(async (req, _ctx, { workspaceId }) => {
  const searchParams = req.nextUrl.searchParams;
  const entityName = searchParams.get("entityName") || "";
  const tokenBudget = parseInt(searchParams.get("tokenBudget") || "160000", 10);

  if (!entityName) {
    return NextResponse.json({ error: "entityName is required" }, { status: 400 });
  }

  // Get trimmed assembly at requested budget
  const trimmed = assembleContext(workspaceId, entityName, tokenBudget);

  // Get untrimmed assembly to compute dropped contexts
  const untrimmed = assembleContext(workspaceId, entityName, UNTRIMMED_BUDGET);

  // Build sets of kept context IDs
  const keptIds = new Set([
    ...trimmed.primaryContexts.map((c) => c.id),
    ...trimmed.referenceContexts.map((c) => c.id),
    ...trimmed.supplementaryContexts.map((c) => c.id),
  ]);

  // Dropped = in untrimmed but not in trimmed
  const droppedContexts: { id: string; name: string; tokenCount: number; role: string }[] = [];

  for (const c of untrimmed.referenceContexts) {
    if (!keptIds.has(c.id)) {
      droppedContexts.push({ id: c.id, name: c.name, tokenCount: c.tokenCount, role: "reference" });
    }
  }
  for (const c of untrimmed.supplementaryContexts) {
    if (!keptIds.has(c.id)) {
      droppedContexts.push({ id: c.id, name: c.name, tokenCount: c.tokenCount, role: "supplementary" });
    }
  }

  // Strip content from response (metadata only)
  const strip = (arr: typeof trimmed.primaryContexts) =>
    arr.map(({ id, name, tokenCount }) => ({ id, name, tokenCount }));

  return NextResponse.json({
    skillsUsed: trimmed.skillsUsed,
    primaryContexts: strip(trimmed.primaryContexts),
    referenceContexts: strip(trimmed.referenceContexts),
    supplementaryContexts: strip(trimmed.supplementaryContexts),
    droppedContexts,
    totalTokens: trimmed.totalTokens,
    budget: tokenBudget,
  });
});
