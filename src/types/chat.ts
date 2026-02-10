import type { ChatSessionStatus, ChatMessageRole, BatchRunStatus } from "@/lib/constants";

export interface ChatSession {
  id: string;
  workspaceId: string;
  fieldMappingId: string | null;
  targetFieldId: string | null;
  entityId: string | null;
  status: ChatSessionStatus;
  messageCount: number;
  lastMessageAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: ChatMessageRole;
  content: string;
  metadata: {
    tokens?: number;
    model?: string;
    provider?: string;
    mappingUpdate?: Record<string, unknown>;
    voiceInput?: boolean;
  } | null;
  createdAt: string;
}

export interface ChatSessionWithMessages extends ChatSession {
  messages: ChatMessage[];
}

export interface BatchRun {
  id: string;
  workspaceId: string;
  status: BatchRunStatus;
  totalEntities: number;
  completedEntities: number;
  failedEntities: number;
  totalFields: number;
  completedFields: number;
  config: {
    provider?: string;
    model?: string;
    skipAlreadyMapped?: boolean;
  } | null;
  startedAt: string | null;
  completedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
