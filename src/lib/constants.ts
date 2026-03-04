// ─── Mapping Statuses ─────────────────────────────────────────
export const MAPPING_STATUSES = [
  "unmapped",
  "unreviewed",
  "accepted",
  "punted",
  "needs_discussion",
  "excluded",
] as const;
export type MappingStatus = (typeof MAPPING_STATUSES)[number];

export const MAPPING_STATUS_COLORS: Record<MappingStatus, string> = {
  unmapped: "#6b7280",
  unreviewed: "#3b82f6",
  accepted: "#22c55e",
  punted: "#f59e0b",
  needs_discussion: "#8b5cf6",
  excluded: "#a8a29e",
};

export const MAPPING_STATUS_LABELS: Record<MappingStatus, string> = {
  unmapped: "Unmapped",
  unreviewed: "Unreviewed",
  accepted: "Accepted",
  punted: "Punted",
  needs_discussion: "Needs Discussion",
  excluded: "Excluded",
};

export const MAPPING_STATUS_DESCRIPTIONS: Record<MappingStatus, string> = {
  unmapped: "No mapping has been defined for this field",
  unreviewed: "Mapping saved, awaiting human review",
  accepted: "Mapping reviewed and accepted",
  punted: "Delegated for further investigation",
  needs_discussion: "Requires additional discussion before acceptance",
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
export const MILESTONES = ["M1", "M2", "M2.5", "M3", "M4", "NR"] as const;
export type Milestone = (typeof MILESTONES)[number];

export const MILESTONE_COLORS: Record<Milestone, string> = {
  M1: "#ef4444",
  M2: "#f59e0b",
  "M2.5": "#f97316",
  M3: "#3b82f6",
  M4: "#6b7280",
  NR: "#d4d4d8",
};

export const MILESTONE_LABELS: Record<Milestone, string> = {
  M1: "M1 — 2/1",
  M2: "M2 — 5/1",
  "M2.5": "M2.5",
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

// ─── Context Tags ────────────────────────────────────────────
export const CONTEXT_TAG_GROUPS = {
  domain: [
    "loans",
    "borrowers",
    "payments",
    "escrow",
    "insurance",
    "foreclosure",
    "loss_mitigation",
    "servicing",
    "investors",
  ] as const,
  data_type: [
    "lookup_values",
    "code_mappings",
    "field_definitions",
    "business_rules",
    "enum_values",
    "status_codes",
    "validation_rules",
  ] as const,
  source_system: [
    "servicemac",
    "valon",
    "vendor",
    "fha",
    "va",
    "fannie_mae",
    "freddie_mac",
    "ginnie_mae",
  ] as const,
} as const;

export const CONTEXT_TAG_GROUP_LABELS: Record<keyof typeof CONTEXT_TAG_GROUPS, string> = {
  domain: "Domain",
  data_type: "Data Type",
  source_system: "Source System",
};

export const CONTEXT_TAGS = [
  ...CONTEXT_TAG_GROUPS.domain,
  ...CONTEXT_TAG_GROUPS.data_type,
  ...CONTEXT_TAG_GROUPS.source_system,
] as const;
export type ContextTag = (typeof CONTEXT_TAGS)[number];

export const CONTEXT_TAG_LABELS: Record<ContextTag, string> = {
  loans: "Loans",
  borrowers: "Borrowers",
  payments: "Payments",
  escrow: "Escrow",
  insurance: "Insurance",
  foreclosure: "Foreclosure",
  loss_mitigation: "Loss Mitigation",
  servicing: "Servicing",
  investors: "Investors",
  lookup_values: "Lookup Values",
  code_mappings: "Code Mappings",
  field_definitions: "Field Definitions",
  business_rules: "Business Rules",
  enum_values: "Enum Values",
  status_codes: "Status Codes",
  validation_rules: "Validation Rules",
  servicemac: "ServiceMac",
  valon: "Valon",
  vendor: "Vendor",
  fha: "FHA",
  va: "VA",
  fannie_mae: "Fannie Mae",
  freddie_mac: "Freddie Mac",
  ginnie_mae: "Ginnie Mae",
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

// ─── Uncertainty Types ──────────────────────────────────────
export const UNCERTAINTY_TYPES = [
  "no_source_match",
  "multiple_candidates",
  "unclear_transform",
  "incomplete_enum",
  "domain_ambiguity",
  "missing_context",
] as const;
export type UncertaintyType = (typeof UNCERTAINTY_TYPES)[number];

export const UNCERTAINTY_TYPE_LABELS: Record<UncertaintyType, string> = {
  no_source_match: "No Source Match",
  multiple_candidates: "Multiple Candidates",
  unclear_transform: "Unclear Transform",
  incomplete_enum: "Incomplete Enum",
  domain_ambiguity: "Domain Ambiguity",
  missing_context: "Missing Context",
};

export const UNCERTAINTY_TYPE_DESCRIPTIONS: Record<UncertaintyType, string> = {
  no_source_match: "No source field could be confidently matched to this target field",
  multiple_candidates: "Multiple source fields are plausible matches — human must pick",
  unclear_transform: "Source exists but the correct transformation logic is uncertain",
  incomplete_enum: "Enum mapping is missing values or source codes are not fully documented",
  domain_ambiguity: "Business meaning of the field is ambiguous or context-dependent",
  missing_context: "Additional documentation or SME input is needed to resolve this mapping",
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
export const QUESTION_STATUSES = ["open", "resolved", "dismissed"] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export const QUESTION_STATUS_LABELS: Record<QuestionStatus, string> = {
  open: "Open",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

export const QUESTION_STATUS_COLORS: Record<QuestionStatus, string> = {
  open: "#3b82f6",
  resolved: "#22c55e",
  dismissed: "#6b7280",
};

// ─── Schema Sides ─────────────────────────────────────────────
export const SCHEMA_SIDES = ["source", "target"] as const;
export type SchemaSide = (typeof SCHEMA_SIDES)[number];

// ─── Schema Formats ───────────────────────────────────────────
export const SCHEMA_FORMATS = ["csv", "json", "sql_ddl", "pdf"] as const;
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
  "ripple_propagated",
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

// ─── Batch Run Statuses ──────────────────────────────────────
export const BATCH_RUN_STATUSES = ["pending", "running", "completed", "failed", "cancelled"] as const;
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

// ─── Chat Session Types ──────────────────────────────────────
export const CHAT_SESSION_TYPES = ["discuss", "entity_discuss", "forge"] as const;
export type ChatSessionType = (typeof CHAT_SESSION_TYPES)[number];

// ─── Chat Session Statuses ───────────────────────────────────
export const CHAT_SESSION_STATUSES = ["active", "resolved", "abandoned"] as const;
export type ChatSessionStatus = (typeof CHAT_SESSION_STATUSES)[number];

// ─── Chat Message Roles ──────────────────────────────────────
export const CHAT_MESSAGE_ROLES = ["user", "assistant", "system"] as const;
export type ChatMessageRole = (typeof CHAT_MESSAGE_ROLES)[number];

// ─── Default workspace ───────────────────────────────────────
export const DEFAULT_WORKSPACE_ID = "fbc37e23-39b4-4cdc-b162-f1f7d9772ab0";

// ─── Field Domains (auto-distribute tags) ────────────────────
// These represent the functional ownership buckets used to match
// workspace members to fields during auto-distribution.
export const FIELD_DOMAINS = [
  "escrow",
  "payments",
  "servicing_infrastructure",
  "delinquency_recovery",
  "delinquency_retention",
  "customer_experience",
] as const;
export type FieldDomain = (typeof FIELD_DOMAINS)[number];

export const FIELD_DOMAIN_LABELS: Record<FieldDomain, string> = {
  escrow:                    "Escrow",
  payments:                  "Payments",
  servicing_infrastructure:  "Servicing Infrastructure",
  delinquency_recovery:      "Delinquency Recovery",
  delinquency_retention:     "Delinquency Retention",
  customer_experience:       "Customer Experience",
};

export const FIELD_DOMAIN_DESCRIPTIONS: Record<FieldDomain, string> = {
  escrow:                   "Escrow account management, tax/insurance disbursements, impound analysis, T&I custodial",
  payments:                 "Payment processing, payment history, transaction ledger (payment side), PI remittance, PI custodial",
  servicing_infrastructure: "Core loan administration, loan setup, ARM/rate data, investor master, pool/MBS registration, boarding",
  delinquency_recovery:     "Collections, charge-offs, foreclosure, REO, bankruptcy, default servicing, agency delinquency reporting",
  delinquency_retention:    "Loss mitigation, loan modifications, forbearance, repayment plans, workout, agency workout reporting",
  customer_experience:      "Borrower communications, self-service portal, correspondence, statements",
};

export const FIELD_DOMAIN_COLORS: Record<FieldDomain, string> = {
  escrow:                   "#0ea5e9",  // sky-500
  payments:                 "#10b981",  // emerald-500
  servicing_infrastructure: "#6366f1",  // indigo-500
  delinquency_recovery:     "#ef4444",  // red-500
  delinquency_retention:    "#f59e0b",  // amber-500
  customer_experience:      "#8b5cf6",  // violet-500
};

// ─── Entity → Domain mapping ──────────────────────────────────
// Canonical mapping of known target entity names (lowercased) to
// their primary domain(s).  Entities with multiple domains signal
// that individual fields within that entity will need per-field
// domain overrides (e.g. ledger has both payment and escrow rows).
//
// This table is the authoritative seed for the auto-distribute
// algorithm and can be extended as the schema evolves.
export const ENTITY_DOMAIN_MAP: Record<string, FieldDomain[]> = {
  // ── Single-domain entities ──────────────────────────────────
  // Escrow
  escrow:                         ["escrow"],
  escrow_account:                 ["escrow"],
  escrow_disbursement:            ["escrow"],
  escrow_analysis:                ["escrow"],
  escrow_shortage:                ["escrow"],
  tax_disbursement:               ["escrow"],
  insurance_disbursement:         ["escrow"],

  // Payments
  // Investor reporting sub-area: PI pass-through remittance and PI custodial
  // are downstream of payment collection → owned by Payments, not a separate IR bucket
  payment:                        ["payments"],
  payment_history:                ["payments"],
  payment_transaction:            ["payments"],
  scheduled_payment:              ["payments"],
  payment_reversal:               ["payments"],
  suspense:                       ["payments"],
  unapplied_funds:                ["payments"],
  remittance:                     ["payments"],   // PI pass-through to investors
  pi_custodial:                   ["payments"],   // Principal & interest custodial account

  // Escrow
  // Investor reporting sub-area: T&I custodial is escrow's remittance analog
  ti_custodial:                   ["escrow"],     // Tax & insurance custodial account

  // Servicing Infrastructure
  // Investor reporting sub-area: pool/investor master records and MBS registration
  // live here — they are reference data, not transactional reporting
  loan:                           ["servicing_infrastructure"],
  loan_master:                    ["servicing_infrastructure"],
  loan_detail:                    ["servicing_infrastructure"],
  interest_rate:                  ["servicing_infrastructure"],
  arm_index:                      ["servicing_infrastructure"],
  investor:                       ["servicing_infrastructure"],   // investor master record
  pool:                           ["servicing_infrastructure"],   // MBS pool / GNMA/FNMA pool setup
  pool_certification:             ["servicing_infrastructure"],   // agency cert/recert
  insurance:                      ["servicing_infrastructure"],
  hazard_insurance:               ["servicing_infrastructure"],
  pmi:                            ["servicing_infrastructure"],

  // Delinquency Recovery
  // Investor reporting sub-area: delinquency & loss reporting to agencies (GNMA/FNMA)
  // is owned by the recovery team that generates the underlying data
  foreclosure:                    ["delinquency_recovery"],
  default:                        ["delinquency_recovery"],
  bankruptcy:                     ["delinquency_recovery"],
  reo:                            ["delinquency_recovery"],
  charge_off:                     ["delinquency_recovery"],
  collections:                    ["delinquency_recovery"],
  collection_activity:            ["delinquency_recovery"],
  delinquency:                    ["delinquency_recovery"],
  agency_delinquency_report:      ["delinquency_recovery"],  // e.g. GNMA default reporting

  // Delinquency Retention
  // Investor reporting sub-area: forbearance/workout reporting to agencies
  // (e.g. CARES Act reporting, FNMA hardship reporting) → owned by retention
  loss_mitigation:                ["delinquency_retention"],
  loan_modification:              ["delinquency_retention"],
  forbearance:                    ["delinquency_retention"],
  repayment_plan:                 ["delinquency_retention"],
  workout:                        ["delinquency_retention"],
  trial_plan:                     ["delinquency_retention"],
  deferral:                       ["delinquency_retention"],
  agency_workout_report:          ["delinquency_retention"],  // e.g. FNMA workout reporting

  // Customer Experience
  borrower:                       ["customer_experience"],
  borrower_contact:               ["customer_experience"],
  correspondence:                 ["customer_experience"],
  statement:                      ["customer_experience"],
  portal_activity:                ["customer_experience"],
  communication_preference:       ["customer_experience"],

  // ── Multi-domain entities (fields require per-field overrides) ─
  // ledger rows are typed by transaction_type:
  //   payment-side rows  → payments
  //   escrow-side rows   → escrow
  ledger:                         ["payments", "escrow"],
  transaction:                    ["payments", "escrow"],
  transaction_history:            ["payments", "escrow"],

  // investor_reporting is a cross-cutting table if it exists as a single entity.
  // Fields should be overridden at the field level:
  //   PI remittance fields           → payments
  //   T&I custodial/escrow fields    → escrow
  //   Pool/certification fields      → servicing_infrastructure
  //   Delinquency reporting fields   → delinquency_recovery
  //   Workout reporting fields       → delinquency_retention
  investor_reporting:             ["payments", "escrow", "servicing_infrastructure", "delinquency_recovery", "delinquency_retention"],

  // The core loan record has servicing infrastructure as primary but
  // the customer-facing fields (contact info, preferences) belong to
  // customer_experience
  loan_borrower:                  ["servicing_infrastructure", "customer_experience"],

  // Collections can feed both recovery (charge-off path) and
  // retention (cure/catch-up path)
  delinquency_detail:             ["delinquency_recovery", "delinquency_retention"],
};
