import type { EntityWithStats } from "./entity";
import type { Milestone } from "@/lib/constants";

export interface MilestoneStats {
  milestone: Milestone;
  totalFields: number;
  mappedFields: number;
  coveragePercent: number;
  statusBreakdown: Record<string, number>;
}

export interface DashboardStats {
  totalEntities: number;
  totalFields: number;
  mappedFields: number;
  coveragePercent: number;
  openQuestions: number;
  entities: EntityWithStats[];
  milestoneStats: MilestoneStats[];
  statusDistribution: Record<string, number>;
}
