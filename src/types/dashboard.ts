import type { EntityWithStats } from "./entity";
import type { Milestone } from "@/lib/constants";
import type { EvaluationStats } from "./evaluation";

export interface MilestoneStats {
  milestone: Milestone;
  totalFields: number;
  mappedFields: number;
  coveragePercent: number;
  statusBreakdown: Record<string, number>;
}

export interface LeaderboardEntry {
  userId: string;
  name: string | null;
  image: string | null;
  count: number;
}

export interface LeaderboardData {
  mostMapped: LeaderboardEntry[];
  mostQuestionsAnswered: LeaderboardEntry[];
  mostBotCollaborations: LeaderboardEntry[];
}

export interface AssignedFieldItem {
  fieldMappingId: string;
  targetFieldId: string;
  targetFieldName: string;
  targetFieldDescription: string | null;
  entityId: string;
  entityName: string;
  status: string;
  confidence: string | null;
  mappingType: string | null;
  puntNote: string | null;
  updatedAt: string;
}

export interface MyQuestionItem {
  id: string;
  question: string;
  status: string;
  priority: string;
  entityId: string | null;
  entityName: string | null;
  fieldName: string | null;
  replyCount: number;
  createdAt: string;
  relationship: "assigned" | "created";
}

export interface MyWorkData {
  assignedFields: AssignedFieldItem[];
  myQuestions: MyQuestionItem[];
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
  leaderboard: LeaderboardData;
  evaluationStats?: EvaluationStats;
}
