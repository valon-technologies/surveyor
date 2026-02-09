import type { QuestionStatus } from "@/lib/constants";

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
  createdAt: string;
  updatedAt: string;
}
