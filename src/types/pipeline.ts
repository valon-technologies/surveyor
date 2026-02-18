export interface PipelineSource {
  name: string;
  alias: string;
  table: string;
  filters?: Record<string, unknown>[];
}

export interface PipelineJoin {
  left: string;
  right: string;
  on: string[];
  how: string;
}

export interface PipelineConcat {
  sources: string[];
  [key: string]: unknown;
}

export interface PipelineColumn {
  target_column: string;
  source: string | Record<string, unknown> | unknown[] | null;
  expression?: string | null;
  transform: string | null;
  hash_columns?: string[] | null;
  dtype: string | null;
}

export type StructureType = "flat" | "assembly";

export interface EntityPipeline {
  id: string;
  workspaceId: string;
  entityId: string;
  version: number;
  parentId: string | null;
  isLatest: boolean;
  yamlSpec: string;
  tableName: string;
  primaryKey: string[] | null;
  sources: PipelineSource[];
  joins: PipelineJoin[] | null;
  concat: PipelineConcat | null;
  structureType: StructureType;
  isStale: boolean;
  generationId: string | null;
  batchRunId: string | null;
  editedBy: string | null;
  changeSummary: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Enriched pipeline data for the UI — includes parsed columns */
export interface EntityPipelineWithColumns extends EntityPipeline {
  columns: PipelineColumn[];
}
