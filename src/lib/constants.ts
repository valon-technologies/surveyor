// ─── Mapping Statuses ─────────────────────────────────────────
export const MAPPING_STATUSES = [
  "unmapped",
  "mapped",
  "not_available",
  "requires_clarification",
  "derived",
  "default",
  "system_generated",
] as const;
export type MappingStatus = (typeof MAPPING_STATUSES)[number];

export const MAPPING_STATUS_COLORS: Record<MappingStatus, string> = {
  unmapped: "#6b7280",
  mapped: "#22c55e",
  not_available: "#9ca3af",
  requires_clarification: "#f59e0b",
  derived: "#8b5cf6",
  default: "#3b82f6",
  system_generated: "#06b6d4",
};

export const MAPPING_STATUS_LABELS: Record<MappingStatus, string> = {
  unmapped: "Unmapped",
  mapped: "Mapped",
  not_available: "N/A",
  requires_clarification: "Needs Clarification",
  derived: "Derived",
  default: "Default",
  system_generated: "System Generated",
};

// ─── Entity Statuses ──────────────────────────────────────────
export const ENTITY_STATUSES = [
  "not_started",
  "in_progress",
  "review",
  "blocked",
  "complete",
] as const;
export type EntityStatus = (typeof ENTITY_STATUSES)[number];

export const ENTITY_STATUS_COLORS: Record<EntityStatus, string> = {
  not_started: "#6b7280",
  in_progress: "#3b82f6",
  review: "#f59e0b",
  blocked: "#ef4444",
  complete: "#22c55e",
};

export const ENTITY_STATUS_LABELS: Record<EntityStatus, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  review: "Review",
  blocked: "Blocked",
  complete: "Complete",
};

// ─── Priority Tiers ───────────────────────────────────────────
export const PRIORITY_TIERS = ["P0", "P1", "P2"] as const;
export type PriorityTier = (typeof PRIORITY_TIERS)[number];

export const TIER_COLORS: Record<PriorityTier, string> = {
  P0: "#ef4444",
  P1: "#f59e0b",
  P2: "#6b7280",
};

export const TIER_LABELS: Record<PriorityTier, string> = {
  P0: "P0 — Critical",
  P1: "P1 — Important",
  P2: "P2 — Nice to Have",
};

// ─── Field Types ──────────────────────────────────────────────
export const FIELD_TYPES = [
  "STRING",
  "NUMBER",
  "DATE",
  "ENUM",
  "BOOLEAN",
  "TIMESTAMP",
  "JSON",
  "ARRAY",
  "DECIMAL",
  "INTEGER",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

// ─── Context Categories ──────────────────────────────────────
export const CONTEXT_CATEGORIES = [
  "foundational",
  "schema",
  "adhoc",
] as const;
export type ContextCategory = (typeof CONTEXT_CATEGORIES)[number];

export const CONTEXT_CATEGORY_LABELS: Record<ContextCategory, string> = {
  foundational: "Foundational",
  schema: "Schema",
  adhoc: "Ad-Hoc",
};

export const CONTEXT_SUBCATEGORIES = {
  foundational: ["domain_knowledge", "business_rules", "glossary"] as const,
  schema: ["code_breaker", "lookup_table", "enum_map", "data_dictionary", "field_spec"] as const,
  adhoc: ["meeting_notes", "transcript", "extract", "working_doc"] as const,
} as const;

export type ContextSubcategory =
  | (typeof CONTEXT_SUBCATEGORIES.foundational)[number]
  | (typeof CONTEXT_SUBCATEGORIES.schema)[number]
  | (typeof CONTEXT_SUBCATEGORIES.adhoc)[number];

export const CONTEXT_SUBCATEGORY_LABELS: Record<ContextSubcategory, string> = {
  domain_knowledge: "Domain Knowledge",
  business_rules: "Business Rules",
  glossary: "Glossary",
  code_breaker: "Code Breaker",
  lookup_table: "Lookup Table",
  enum_map: "Enum Map",
  data_dictionary: "Data Dictionary",
  field_spec: "Field Spec",
  meeting_notes: "Meeting Notes",
  transcript: "Transcript",
  extract: "Extract",
  working_doc: "Working Doc",
};

// ─── Skill Context Roles ──────────────────────────────────────
export const SKILL_CONTEXT_ROLES = ["primary", "reference", "supplementary"] as const;
export type SkillContextRole = (typeof SKILL_CONTEXT_ROLES)[number];

export const SKILL_CONTEXT_ROLE_LABELS: Record<SkillContextRole, string> = {
  primary: "Primary",
  reference: "Reference",
  supplementary: "Supplementary",
};

// ─── Confidence Levels ────────────────────────────────────────
export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const CONFIDENCE_COLORS: Record<ConfidenceLevel, string> = {
  high: "#22c55e",
  medium: "#f59e0b",
  low: "#ef4444",
};

// ─── Context Types (mapping_context.contextType) ─────────────
export const CONTEXT_TYPES = [
  "context_reference",
  "sample_data",
  "qa_answer",
  "validation_result",
  "manual_note",
] as const;
export type ContextType = (typeof CONTEXT_TYPES)[number];

// ─── Thread Statuses ──────────────────────────────────────────
export const THREAD_STATUSES = ["open", "resolved", "archived"] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];

export const THREAD_STATUS_COLORS: Record<ThreadStatus, string> = {
  open: "#3b82f6",
  resolved: "#22c55e",
  archived: "#6b7280",
};

export const THREAD_STATUS_LABELS: Record<ThreadStatus, string> = {
  open: "Open",
  resolved: "Resolved",
  archived: "Archived",
};

// ─── Generation Types ─────────────────────────────────────────
export const GENERATION_TYPES = [
  "field_mapping",
  "enum_mapping",
  "entity_review",
  "question_generation",
] as const;
export type GenerationType = (typeof GENERATION_TYPES)[number];

// ─── Question Statuses ────────────────────────────────────────
export const QUESTION_STATUSES = ["open", "answered", "dismissed"] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

// ─── Schema Sides ─────────────────────────────────────────────
export const SCHEMA_SIDES = ["source", "target"] as const;
export type SchemaSide = (typeof SCHEMA_SIDES)[number];

// ─── Schema Formats ───────────────────────────────────────────
export const SCHEMA_FORMATS = ["csv", "json", "sql_ddl"] as const;
export type SchemaFormat = (typeof SCHEMA_FORMATS)[number];

// ─── Default workspace ───────────────────────────────────────
export const DEFAULT_WORKSPACE_ID = "fbc37e23-39b4-4cdc-b162-f1f7d9772ab0";
