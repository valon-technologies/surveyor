import type { ChatSessionStatus, ChatSessionType, ChatMessageRole, BatchRunStatus } from "@/lib/constants";

export interface ChatSession {
  id: string;
  workspaceId: string;
  fieldMappingId: string | null;
  targetFieldId: string | null;
  entityId: string | null;
  sessionType: ChatSessionType;
  skillId: string | null;
  status: ChatSessionStatus;
  messageCount: number;
  lastMessageAt: string | null;
  createdBy: string;
  createdByName?: string | null;
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
    kickoff?: boolean;
    toolCalls?: Array<{
      name: string;
      sql: string;
      purpose: string;
      success: boolean;
      durationMs: number;
    }>;
  } | null;
  createdAt: string;
}

export interface ChatSessionWithMessages extends ChatSession {
  messages: ChatMessage[];
}

export interface EntityMappingUpdate {
  targetFieldName: string;
  mappingType?: string | null;
  sourceEntityName?: string | null;
  sourceFieldName?: string | null;
  sourceEntityId?: string | null;
  sourceFieldId?: string | null;
  transform?: string | null;
  defaultValue?: string | null;
  enumMapping?: Record<string, string | null> | null;
  reasoning?: string | null;
  confidence?: string | null;
  notes?: string | null;
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
  currentEntityName: string | null;
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
