import type { GenerationType, MappingStatus, MappingType, ConfidenceLevel, UncertaintyType } from "@/lib/constants";

export interface Generation {
  id: string;
  workspaceId: string;
  entityId: string | null;
  generationType: GenerationType;
  status: string;
  provider: string | null;
  model: string | null;
  promptSnapshot: {
    systemMessage: string;
    userMessage: string;
    skillsUsed: string[];
  } | null;
  output: string | null;
  outputParsed: Record<string, unknown> | null;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
  error: string | null;
  validationScore: number | null;
  validationIssues: Record<string, unknown>[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface ParsedFieldMapping {
  targetFieldName: string;
  targetFieldId: string | null;
  status: MappingStatus;
  mappingType: MappingType | null;
  sourceEntityName: string | null;
  sourceEntityId: string | null;
  sourceFieldName: string | null;
  sourceFieldId: string | null;
  transform: string | null;
  defaultValue: string | null;
  enumMapping: Record<string, string> | null;
  reasoning: string | null;
  confidence: ConfidenceLevel | null;
  notes: string | null;
  reviewComment: string | null;
  uncertaintyType: UncertaintyType | null;
  resolveWarnings: string[];
}

export interface ParsedQuestion {
  targetFieldName: string | null;
  targetFieldId: string | null;
  questionText: string;
  questionType: UncertaintyType;
  priority: "urgent" | "high" | "normal" | "low";
}

export interface ParseResult {
  fieldMappings: ParsedFieldMapping[];
  parseErrors: string[];
  unmappedFields: string[];
  questions: ParsedQuestion[];
}

export interface GenerationRunResult {
  generationId: string;
  status: "completed" | "failed";
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  parsedOutput: ParseResult | null;
  error?: string;
}

export interface GenerationStartResult {
  generationId: string;
  status: "running";
  entityId: string;
  entityName: string;
  fieldCount: number;
  provider: string;
  model: string;
}
