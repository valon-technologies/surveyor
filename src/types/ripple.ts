import type { MappingType, ConfidenceLevel } from "@/lib/constants";

export interface SimilaritySignals {
  sourceMatch: number;
  transformPattern: number;
  contextOverlap: number;
}

export interface SimilarityResult {
  mappingId: string;
  targetFieldId: string;
  targetFieldName: string;
  entityId: string;
  entityName: string;
  score: number;
  signals: SimilaritySignals;
  reason: string;
}

export interface MappingSnapshot {
  mappingType: MappingType | null;
  sourceEntityName: string | null;
  sourceFieldName: string | null;
  sourceEntityId: string | null;
  sourceFieldId: string | null;
  transform: string | null;
  defaultValue: string | null;
  enumMapping: Record<string, string | null> | null;
  reasoning: string | null;
  confidence: ConfidenceLevel | null;
  notes: string | null;
}

export interface RippleProposal {
  originalMappingId: string;
  targetFieldId: string;
  targetFieldName: string;
  entityId: string;
  entityName: string;
  before: MappingSnapshot;
  after: MappingSnapshot;
  generationId: string;
}
