import type { EntityWithStats } from "./entity";

export interface DashboardStats {
  totalEntities: number;
  totalFields: number;
  mappedFields: number;
  coveragePercent: number;
  openQuestions: number;
  entitiesByTier: {
    P0: EntityWithStats[];
    P1: EntityWithStats[];
    P2: EntityWithStats[];
    unassigned: EntityWithStats[];
  };
  statusDistribution: Record<string, number>;
}
