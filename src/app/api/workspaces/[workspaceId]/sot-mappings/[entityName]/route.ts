import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { loadSotEntity } from "@/lib/sot/yaml-parser";
import { getOnboardingTasksForEntity } from "@/lib/sot/onboarding-config";

// GET — Get detailed SOT mapping for a specific entity
export const GET = withAuth(async (req, ctx) => {
  const { entityName } = await ctx.params;

  if (!entityName) {
    return NextResponse.json(
      { error: "Missing entityName" },
      { status: 400 }
    );
  }

  const url = new URL(req.url);
  const milestone = (url.searchParams.get("milestone") || "m1") as
    | "m1"
    | "m2";

  if (milestone !== "m1" && milestone !== "m2") {
    return NextResponse.json(
      { error: "Invalid milestone — must be m1 or m2" },
      { status: 400 }
    );
  }

  const mapping = loadSotEntity(entityName, milestone);

  if (!mapping) {
    return NextResponse.json(
      { error: `No SOT mapping found for entity "${entityName}" at ${milestone}` },
      { status: 404 }
    );
  }

  const onboardingTasks = getOnboardingTasksForEntity(entityName);

  return NextResponse.json({
    ...mapping,
    onboardingTasks,
  });
});
