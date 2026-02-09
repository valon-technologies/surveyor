import type { ThreadStatus } from "@/lib/constants";

export interface CommentThread {
  id: string;
  workspaceId: string;
  entityId: string | null;
  fieldMappingId: string | null;
  subject: string | null;
  status: ThreadStatus;
  resolvedBy: string | null;
  resolvedAt: string | null;
  commentCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Comment {
  id: string;
  threadId: string;
  authorName: string;
  body: string;
  bodyFormat: string;
  metadata: Record<string, unknown> | null;
  editedAt: string | null;
  createdAt: string;
}

export interface ThreadWithComments extends CommentThread {
  comments: Comment[];
}

export interface CreateThreadInput {
  entityId?: string;
  fieldMappingId?: string;
  subject?: string;
  createdBy: string;
  body: string;
  bodyFormat?: string;
}

export interface CreateCommentInput {
  authorName: string;
  body: string;
  bodyFormat?: string;
}
