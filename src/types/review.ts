import type { MappingType, ConfidenceLevel, MappingStatus } from "@/lib/constants";

export interface ReviewCardData {
  id: string; // fieldMapping.id
  targetFieldId: string;
  targetFieldName: string;
  targetFieldDescription: string | null;
  targetFieldDataType: string | null;
  milestone: string | null;
  entityId: string;
  entityName: string;
  entityMetadata: Record<string, unknown> | null;
  parentEntityId: string | null;
  parentEntityName: string | null;
  status: MappingStatus;
  mappingType: MappingType | null;
  confidence: ConfidenceLevel | null;
  sourceEntityId: string | null;
  sourceFieldId: string | null;
  sourceEntityName: string | null;
  sourceFieldName: string | null;
  transform: string | null;
  defaultValue: string | null;
  reasoning: string | null;
  reviewComment: string | null;
  notes: string | null;
  puntNote: string | null;
  excludeReason: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  createdBy: string;
  batchRunId: string | null;
  createdAt: string;
}

export interface ChildEntityGroup {
  entityId: string;
  entityName: string;
  cards: ReviewCardData[];
}

export interface VerdictHistoryItem {
  id: string;
  targetFieldName: string;
  targetFieldDataType: string | null;
  entityName: string;
  status: MappingStatus;
  sourceVerdict: string | null;
  transformVerdict: string | null;
  sourceFieldName: string | null;
  sourceEntityName: string | null;
  transferId: string | null;
  transferName: string | null;
  mappingType: MappingType | null;
  confidence: ConfidenceLevel | null;
  notes: string | null;
  updatedAt: string;
}

export type ReviewSortBy = "confidence" | "entityName" | "createdAt" | "targetFieldName";
export type ReviewSortOrder = "asc" | "desc";
