// ─── Mapping Statuses ─────────────────────────────────────────
export const MAPPING_STATUSES = [
  "unmapped",
  "pending",
  "open_comment_sm",
  "open_comment_vt",
  "fully_closed",
  "excluded",
] as const;
export type MappingStatus = (typeof MAPPING_STATUSES)[number];

export const MAPPING_STATUS_COLORS: Record<MappingStatus, string> = {
  unmapped: "#6b7280",
  pending: "#3b82f6",
  open_comment_sm: "#f59e0b",
  open_comment_vt: "#8b5cf6",
  fully_closed: "#22c55e",
  excluded: "#a8a29e",
};

export const MAPPING_STATUS_LABELS: Record<MappingStatus, string> = {
  unmapped: "Unmapped",
  pending: "Pending",
  open_comment_sm: "Open Comment (SM)",
  open_comment_vt: "Open Comment (VT)",
  fully_closed: "Fully Closed",
  excluded: "Excluded",
};

export const MAPPING_STATUS_DESCRIPTIONS: Record<MappingStatus, string> = {
  unmapped: "No mapping has been defined for this field",
  pending: "Mapping saved, awaiting review or comment",
  open_comment_sm: "Open comment from ServiceMac team requiring response",
  open_comment_vt: "Open comment from Valon Tech team requiring response",
  fully_closed: "Mapping reviewed, validated, and closed",
  excluded: "Business decided this field does not need mapping",
};

// ─── Mapping Types ───────────────────────────────────────────
export const MAPPING_TYPES = [
  "direct",
  "rename",
  "type_cast",
  "enum",
  "flatten_to_normalize",
  "aggregate",
  "join",
  "derived",
  "pivot",
  "conditional",
] as const;
export type MappingType = (typeof MAPPING_TYPES)[number];

export const MAPPING_TYPE_LABELS: Record<MappingType, string> = {
  direct: "Direct",
  rename: "Rename",
  type_cast: "Type Cast",
  enum: "Enum",
  flatten_to_normalize: "Flatten / Normalize",
  aggregate: "Aggregate",
  join: "Join",
  derived: "Derived",
  pivot: "Pivot",
  conditional: "Conditional",
};

export const MAPPING_TYPE_DESCRIPTIONS: Record<MappingType, string> = {
  direct: "1:1 copy — same field name and type, no transformation needed",
  rename: "Same data, different field name in the target schema",
  type_cast: "Same data but requires a type conversion (e.g. string → date)",
  enum: "Source values must be mapped to a target enumeration",
  flatten_to_normalize: "Nested or repeated source data flattened into a normalized structure",
  aggregate: "Multiple source rows aggregated into a single target value",
  join: "Target value requires joining two or more source tables",
  derived: "Computed from one or more source fields via business logic",
  pivot: "Source rows pivoted into target columns (or vice versa)",
  conditional: "Mapping logic varies based on runtime conditions",
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

// ─── Milestones (field-level delivery targets) ──────────────
export const MILESTONES = ["M1", "M2", "M3", "M4", "NR"] as const;
export type Milestone = (typeof MILESTONES)[number];

export const MILESTONE_COLORS: Record<Milestone, string> = {
  M1: "#ef4444",
  M2: "#f59e0b",
  M3: "#3b82f6",
  M4: "#6b7280",
  NR: "#d4d4d8",
};

export const MILESTONE_LABELS: Record<Milestone, string> = {
  M1: "M1 — 2/1",
  M2: "M2 — 5/1",
  M3: "M3 — 7/1",
  M4: "M4 — 9/1",
  NR: "Not Required",
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

// ─── Workspace Teams ─────────────────────────────────────────
export const WORKSPACE_TEAMS = ["SM", "VT"] as const;
export type WorkspaceTeam = (typeof WORKSPACE_TEAMS)[number];

export const WORKSPACE_TEAM_LABELS: Record<WorkspaceTeam, string> = {
  SM: "ServiceMac",
  VT: "Valon Tech",
};

// ─── Workspace Roles ─────────────────────────────────────────
export const WORKSPACE_ROLES = ["owner", "editor", "viewer"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const WORKSPACE_ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: "Owner",
  editor: "Editor",
  viewer: "Viewer",
};

// ─── Activity Actions ────────────────────────────────────────
export const ACTIVITY_ACTIONS = [
  "status_change",
  "comment_added",
  "thread_created",
  "thread_resolved",
  "mapping_saved",
  "validation_ran",
  "case_closed",
  "case_reopened",
] as const;
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

// ─── Invite Statuses ─────────────────────────────────────────
export const INVITE_STATUSES = ["pending", "accepted", "revoked"] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

// ─── LLM Models ─────────────────────────────────────────────
export const LLM_MODELS = {
  claude: [
    { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5", context: 200_000, costTier: "low" },
    { id: "claude-sonnet-4-5-20250929", label: "Sonnet 4.5", context: 200_000, costTier: "medium" },
    { id: "claude-opus-4-6", label: "Opus 4.6", context: 200_000, costTier: "high" },
  ],
  openai: [
    { id: "gpt-4o-mini", label: "GPT-4o mini", context: 128_000, costTier: "low" },
    { id: "gpt-4o", label: "GPT-4o", context: 128_000, costTier: "medium" },
    { id: "o1", label: "o1", context: 200_000, costTier: "high" },
  ],
} as const;

export type LLMProvider = keyof typeof LLM_MODELS;
export type LLMModelId = (typeof LLM_MODELS)[LLMProvider][number]["id"];

/** Smart defaults: fast/cheap for single-field, balanced for batch */
export const DEFAULT_MODELS: Record<LLMProvider, { singleField: string; batch: string }> = {
  claude: { singleField: "claude-haiku-4-5-20251001", batch: "claude-sonnet-4-5-20250929" },
  openai: { singleField: "gpt-4o-mini", batch: "gpt-4o" },
};

// ─── Review Statuses ──────────────────────────────────────────
export const REVIEW_STATUSES = ["accepted", "punted", "needs_discussion"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  accepted: "Accepted",
  punted: "Punted",
  needs_discussion: "Needs Discussion",
};

export const REVIEW_STATUS_COLORS: Record<ReviewStatus, string> = {
  accepted: "#22c55e",
  punted: "#f59e0b",
  needs_discussion: "#3b82f6",
};

// ─── Batch Run Statuses ──────────────────────────────────────
export const BATCH_RUN_STATUSES = ["pending", "running", "completed", "failed"] as const;
export type BatchRunStatus = (typeof BATCH_RUN_STATUSES)[number];

// ─── Question Priorities ─────────────────────────────────────
export const QUESTION_PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export type QuestionPriority = (typeof QUESTION_PRIORITIES)[number];

export const QUESTION_PRIORITY_LABELS: Record<QuestionPriority, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};

export const QUESTION_PRIORITY_COLORS: Record<QuestionPriority, string> = {
  urgent: "#ef4444",
  high: "#f59e0b",
  normal: "#6b7280",
  low: "#d4d4d8",
};

// ─── Chat Session Statuses ───────────────────────────────────
export const CHAT_SESSION_STATUSES = ["active", "resolved", "abandoned"] as const;
export type ChatSessionStatus = (typeof CHAT_SESSION_STATUSES)[number];

// ─── Chat Message Roles ──────────────────────────────────────
export const CHAT_MESSAGE_ROLES = ["user", "assistant", "system"] as const;
export type ChatMessageRole = (typeof CHAT_MESSAGE_ROLES)[number];

// ─── Default workspace ───────────────────────────────────────
export const DEFAULT_WORKSPACE_ID = "fbc37e23-39b4-4cdc-b162-f1f7d9772ab0";
