import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { listSotEntities } from "@/lib/sot/yaml-parser";
import {
  hasOnboardingConfig,
  getOnboardingTasksForEntity,
} from "@/lib/sot/onboarding-config";

// GET — List all SOT mapping entities with summary stats
export const GET = withAuth(async () => {
  const entities = listSotEntities();

  // Enrich each entity summary with onboarding info
  const enriched = entities.map((e) => ({
    ...e,
    hasOnboardingConfig: hasOnboardingConfig(e.name),
    onboardingTasks: getOnboardingTasksForEntity(e.name),
  }));

  // Compute aggregate stats
  const m1Count = entities.filter((e) => e.milestone === "m1").length;
  const m2Count = entities.filter((e) => e.milestone === "m2").length;
  const totalFields = entities.reduce((sum, e) => sum + e.fieldCount, 0);
  const onboardedCount = entities.filter((e) =>
    hasOnboardingConfig(e.name)
  ).length;

  return NextResponse.json({
    entities: enriched,
    stats: {
      m1Count,
      m2Count,
      totalFields,
      onboardedCount,
    },
  });
});
