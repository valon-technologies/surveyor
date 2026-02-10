import type { ReviewStatus, MappingType, ConfidenceLevel, MappingStatus } from "@/lib/constants";

export interface ReviewCardData {
  id: string; // fieldMapping.id
  targetFieldId: string;
  targetFieldName: string;
  targetFieldDescription: string | null;
  targetFieldDataType: string | null;
  milestone: string | null;
  entityId: string;
  entityName: string;
  status: MappingStatus;
  reviewStatus: ReviewStatus | null;
  mappingType: MappingType | null;
  confidence: ConfidenceLevel | null;
  sourceEntityName: string | null;
  sourceFieldName: string | null;
  transform: string | null;
  defaultValue: string | null;
  reasoning: string | null;
  notes: string | null;
  puntNote: string | null;
  createdBy: string;
  batchRunId: string | null;
  createdAt: string;
}

export type ReviewSortBy = "confidence" | "entityName" | "createdAt" | "targetFieldName";
export type ReviewSortOrder = "asc" | "desc";
