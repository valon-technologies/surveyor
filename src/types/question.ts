import type { QuestionStatus, QuestionPriority, WorkspaceTeam } from "@/lib/constants";

export interface QuestionReply {
  id: string;
  questionId: string;
  authorId: string | null;
  authorName: string;
  authorRole: "user" | "llm" | "system";
  body: string;
  isResolution: boolean;
  metadata: Record<string, unknown> | null;
  editedAt: string | null;
  createdAt: string;
}

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
  schemaAssetIds: string[] | null;
  assigneeIds: string[] | null;
  // Threaded question fields
  resolvedBy: string | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
  replyCount: number;
  createdByUserId: string | null;
  replies?: QuestionReply[];
  createdAt: string;
  updatedAt: string;
  // Joined from entity/field tables
  entityName: string | null;
  fieldName: string | null;
  // Resolved for display (populated by GET endpoint)
  schemaAssets?: Array<{ id: string; name: string; side: string }>;
  assignees?: Array<{ userId: string; name: string | null; email: string; image: string | null }>;
}
