import type { QuestionStatus, QuestionPriority, WorkspaceTeam } from "@/lib/constants";

export interface Question {
  id: string;
  workspaceId: string;
  entityId: string | null;
  fieldId: string | null;
  question: string;
  answer: string | null;
  status: QuestionStatus;
  askedBy: string;
  answeredBy: string | null;
  priority: QuestionPriority;
  targetForTeam: WorkspaceTeam | null;
  fieldMappingId: string | null;
  chatSessionId: string | null;
  createdAt: string;
  updatedAt: string;
}
