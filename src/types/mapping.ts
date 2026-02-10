import type { MappingStatus, MappingType, ConfidenceLevel } from "@/lib/constants";

export interface FieldMapping {
  id: string;
  workspaceId: string;
  targetFieldId: string;
  status: MappingStatus;
  mappingType: MappingType | null;
  assigneeId: string | null;
  sourceEntityId: string | null;
  sourceFieldId: string | null;
  transform: string | null;
  defaultValue: string | null;
  enumMapping: Record<string, string> | null;
  reasoning: string | null;
  confidence: ConfidenceLevel | null;
  notes: string | null;
  createdBy: string;
  generationId: string | null;
  version: number;
  parentId: string | null;
  isLatest: boolean;
  editedBy: string | null;
  changeSummary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FieldMappingCreateInput {
  targetFieldId: string;
  status?: MappingStatus;
  mappingType?: MappingType;
  assigneeId?: string;
  sourceEntityId?: string;
  sourceFieldId?: string;
  transform?: string;
  defaultValue?: string;
  enumMapping?: Record<string, string>;
  reasoning?: string;
  confidence?: ConfidenceLevel;
  notes?: string;
  reviewComment?: string;
  createdBy?: string;
}

export interface FieldMappingUpdateInput {
  status?: MappingStatus;
  mappingType?: MappingType | null;
  assigneeId?: string | null;
  sourceEntityId?: string | null;
  sourceFieldId?: string | null;
  transform?: string | null;
  defaultValue?: string | null;
  enumMapping?: Record<string, string> | null;
  reasoning?: string | null;
  confidence?: ConfidenceLevel | null;
  notes?: string | null;
  editedBy?: string;
}

export interface MappingWithContext extends FieldMapping {
  targetField: {
    id: string;
    name: string;
    displayName: string | null;
    dataType: string | null;
    entityId: string;
    entityName: string;
  };
  sourceField?: {
    id: string;
    name: string;
    displayName: string | null;
    entityId: string;
    entityName: string;
  };
  contexts: Array<{
    id: string;
    contextType: string;
    excerpt: string | null;
    contextId: string | null;
    contextName?: string;
  }>;
}

export interface MappingHistoryEntry {
  id: string;
  version: number;
  status: MappingStatus;
  mappingType: MappingType | null;
  assigneeId: string | null;
  editedBy: string | null;
  changeSummary: string | null;
  createdBy: string;
  createdAt: string;
}

export interface MappingContextDetail {
  id: string;
  fieldMappingId: string;
  contextId: string | null;
  contextType: string;
  excerpt: string | null;
  relevance: string | null;
  createdAt: string;
  contextName: string | null;
  contextCategory: string | null;
  contextPreview: string | null;
}
