import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";

// Helper defaults
const nowDefault = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

// ─── Auth Tables ──────────────────────────────────────────────

export const user = sqliteTable("user", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: text("email_verified"),
  image: text("image"),
  passwordHash: text("password_hash"),
  createdAt: text("created_at").notNull().default(nowDefault),
  updatedAt: text("updated_at").notNull().default(nowDefault),
});

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [
    index("account_user_idx").on(table.userId),
  ]
);

export const verificationToken = sqliteTable(
  "verification_token",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: text("expires").notNull(),
  },
  (table) => [
    index("verification_token_idx").on(table.identifier, table.token),
  ]
);

export const userWorkspace = sqliteTable(
  "user_workspace",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("editor"), // owner | editor | viewer
    team: text("team"), // SM | VT | null
    createdAt: text("created_at").notNull().default(nowDefault),
  },
  (table) => [
    index("user_workspace_user_idx").on(table.userId),
    index("user_workspace_workspace_idx").on(table.workspaceId),
  ]
);

export const workspaceInvite = sqliteTable(
  "workspace_invite",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull().default("editor"),
    status: text("status").notNull().default("pending"), // pending | accepted | revoked
    invitedBy: text("invited_by")
      .notNull()
      .references(() => user.id),
    acceptedBy: text("accepted_by").references(() => user.id),
    acceptedAt: text("accepted_at"),
    expiresAt: text("expires_at"),
    createdAt: text("created_at").notNull().default(nowDefault),
  },
  (table) => [
    index("workspace_invite_workspace_idx").on(table.workspaceId),
    index("workspace_invite_email_idx").on(table.email),
  ]
);

export const userApiKey = sqliteTable(
  "user_api_key",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // claude | openai
    encryptedKey: text("encrypted_key").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    keyPrefix: text("key_prefix"), // first 8 chars for display
    createdAt: text("created_at").notNull().default(nowDefault),
    updatedAt: text("updated_at").notNull().default(nowDefault),
  },
  (table) => [
    index("user_api_key_user_idx").on(table.userId),
    index("user_api_key_user_provider_idx").on(table.userId, table.provider),
  ]
);

export const userBigqueryToken = sqliteTable(
  "user_bigquery_token",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    email: text("email"),
    encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    scope: text("scope"),
    createdAt: text("created_at").notNull().default(nowDefault),
    updatedAt: text("updated_at").notNull().default(nowDefault),
  },
  (table) => [
    index("user_bq_token_user_idx").on(table.userId),
  ]
);

// ─── Tables ───────────────────────────────────────────────────

export const workspace = sqliteTable("workspace", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  settings: text("settings", { mode: "json" }).$type<{
    tokenLimit?: number;
    defaultProvider?: string;
    bigquery?: {
      projectId: string;
      sourceDataset: string;
      targetDataset?: string;
    };
  }>(),
  createdAt: text("created_at").notNull().default(nowDefault),
  updatedAt: text("updated_at").notNull().default(nowDefault),
});

export const schemaAsset = sqliteTable(
  "schema_asset",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    side: text("side").notNull(), // source | target
    description: text("description"),
    sourceFile: text("source_file"),
    format: text("format").notNull().default("csv"), // csv | json | sql_ddl
    rawContent: text("raw_content"),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: text("created_at").notNull().default(nowDefault),
    updatedAt: text("updated_at").notNull().default(nowDefault),
  },
  (table) => [
    index("schema_asset_workspace_idx").on(table.workspaceId),
    index("schema_asset_side_idx").on(table.workspaceId, table.side),
  ]
);

export const entity = sqliteTable(
  "entity",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    schemaAssetId: text("schema_asset_id")
      .notNull()
      .references(() => schemaAsset.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    displayName: text("display_name"),
    side: text("side").notNull(), // source | target (denormalized)
    description: text("description"),
    parentEntityId: text("parent_entity_id"), // FK to entity.id — self-ref handled by migration + relations
    // Target-only fields
    status: text("status").notNull().default("not_started"), // not_started | in_progress | review | blocked | complete
    sortOrder: integer("sort_order").notNull().default(0),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: text("created_at").notNull().default(nowDefault),
    updatedAt: text("updated_at").notNull().default(nowDefault),
  },
  (table) => [
    index("entity_workspace_idx").on(table.workspaceId),
    index("entity_schema_asset_idx").on(table.schemaAssetId),
    index("entity_side_idx").on(table.workspaceId, table.side),
    index("entity_status_idx").on(table.workspaceId, table.status),
  ]
);

export const field = sqliteTable(
  "field",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    entityId: text("entity_id")
      .notNull()
      .references(() => entity.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    displayName: text("display_name"),
    dataType: text("data_type"), // STRING | NUMBER | DATE | ENUM | BOOLEAN | etc.
    isRequired: integer("is_required", { mode: "boolean" }).notNull().default(false),
    isKey: integer("is_key", { mode: "boolean" }).notNull().default(false),
    description: text("description"),
    milestone: text("milestone"), // M1 | M2 | M3 | M4
    sampleValues: text("sample_values", { mode: "json" }).$type<string[]>(),
    enumValues: text("enum_values", { mode: "json" }).$type<string[]>(),
    sortOrder: integer("sort_order").notNull().default(0),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: text("created_at").notNull().default(nowDefault),
    updatedAt: text("updated_at").notNull().default(nowDefault),
  },
  (table) => [
    index("field_entity_name_idx").on(table.entityId, table.name),
    index("field_entity_idx").on(table.entityId),
  ]
);

export const fieldMapping = sqliteTable(
  "field_mapping",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    targetFieldId: text("target_field_id")
      .notNull()
      .references(() => field.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("unmapped"),
    // unmapped | unreviewed | accepted | punted | needs_discussion | excluded
    mappingType: text("mapping_type"),
    // direct | rename | type_cast | enum | flatten_to_normalize | aggregate | join | derived | pivot | conditional
    assigneeId: text("assignee_id").references(() => user.id, { onDelete: "set null" }),
    sourceEntityId: text("source_entity_id").references(() => entity.id),
    sourceFieldId: text("source_field_id").references(() => field.id),
    transform: text("transform"), // SQL expression
    defaultValue: text("default_value"),
    enumMapping: text("enum_mapping", { mode: "json" }).$type<Record<string, string>>(),
    reasoning: text("reasoning"),
    confidence: text("confidence"), // high | medium | low
    notes: text("notes"),
    createdBy: text("created_by").notNull().default("manual"), // manual | llm | import
    generationId: text("generation_id"),
    version: integer("version").notNull().default(1),
    parentId: text("parent_id"),
    isLatest: integer("is_latest", { mode: "boolean" }).notNull().default(true),
    editedBy: text("edited_by"),
    changeSummary: text("change_summary"),
    // reviewStatus column dropped — status field is now unified
    puntNote: text("punt_note"),
    excludeReason: text("exclude_reason"),
    batchRunId: text("batch_run_id"),
    createdAt: text("created_at").notNull().default(nowDefault),
    updatedAt: text("updated_at").notNull().default(nowDefault),
  },
  (table) => [
    index("mapping_workspace_idx").on(table.workspaceId),
    index("mapping_target_field_idx").on(table.targetFieldId),
    index("mapping_source_field_idx").on(table.sourceFieldId),
    index("mapping_status_idx").on(table.workspaceId, table.status),
    index("mapping_latest_idx").on(table.targetFieldId, table.isLatest),
    index("mapping_assignee_idx").on(table.assigneeId),
  ]
);

export const context = sqliteTable(
  "context",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category").notNull(), // foundational | schema | adhoc
    subcategory: text("subcategory"), // domain_knowledge | business_rules | glossary | code_breaker | ...
    entityId: text("entity_id").references(() => entity.id, { onDelete: "set null" }),
    fieldId: text("field_id").references(() => field.id, { onDelete: "set null" }),
    content: text("content").notNull().default(""),
    contentFormat: text("content_format").notNull().default("markdown"),
    tokenCount: integer("token_count"),
    tags: text("tags", { mode: "json" }).$type<string[]>(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    importSource: text("import_source"),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: text("created_at").notNull().default(nowDefault),
    updatedAt: text("updated_at").notNull().default(nowDefault),
  },
  (table) => [
    index("context_workspace_idx").on(table.workspaceId),
    index("context_category_idx").on(table.workspaceId, table.category),
    index("context_entity_idx").on(table.entityId),
    index("context_field_idx").on(table.fieldId),
  ]
);

export const mappingContext = sqliteTable(
  "mapping_context",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    fieldMappingId: text("field_mapping_id")
      .notNull()
      .references(() => fieldMapping.id, { onDelete: "cascade" }),
    contextId: text("context_id").references(() => context.id, { onDelete: "set null" }),
    contextType: text("context_type").notNull(),
    // context_reference | sample_data | qa_answer | validation_result | manual_note
    excerpt: text("excerpt"),
    relevance: text("relevance"),
    createdAt: text("created_at").notNull().default(nowDefault),
  },
  (table) => [
    index("mapping_context_mapping_idx").on(table.fieldMappingId),
    index("mapping_context_context_idx").on(table.contextId),
  ]
);

export const commentThread = sqliteTable(
  "comment_thread",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    entityId: text("entity_id").references(() => entity.id, { onDelete: "cascade" }),
    fieldMappingId: text("field_mapping_id").references(() => fieldMapping.id, { onDelete: "cascade" }),
    subject: text("subject"),
    status: text("status").notNull().default("open"), // open | resolved | archived
    resolvedBy: text("resolved_by"),
    resolvedAt: text("resolved_at"),
    commentCount: integer("comment_count").notNull().default(0),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull().default(nowDefault),
    updatedAt: text("updated_at").notNull().default(nowDefault),
  },
  (table) => [
    index("thread_workspace_idx").on(table.workspaceId),
    index("thread_entity_idx").on(table.entityId),
    index("thread_mapping_idx").on(table.fieldMappingId),
    index("thread_status_idx").on(table.workspaceId, table.status),
  ]
);

export const comment = sqliteTable(
  "comment",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    threadId: text("thread_id")
      .notNull()
      .references(() => commentThread.id, { onDelete: "cascade" }),
    authorName: text("author_name").notNull(),
    body: text("body").notNull(),
    bodyFormat: text("body_format").notNull().default("markdown"), // markdown | plain
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    editedAt: text("edited_at"),
    createdAt: text("created_at").notNull().default(nowDefault),
  },
  (table) => [
    index("comment_thread_idx").on(table.threadId),
    index("comment_thread_created_idx").on(table.threadId, table.createdAt),
  ]
);

export const question = sqliteTable(
  "question",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    entityId: text("entity_id").references(() => entity.id, { onDelete: "cascade" }),
    fieldId: text("field_id").references(() => field.id, { onDelete: "set null" }),
    question: text("question").notNull(),
    answer: text("answer"), // backward compat — populated on resolve
    status: text("status").notNull().default("open"), // open | resolved | dismissed
    askedBy: text("asked_by").notNull().default("user"), // user | llm
    answeredBy: text("answered_by"), // backward compat — populated on resolve
    priority: text("priority").notNull().default("normal"), // urgent | high | normal | low
    targetForTeam: text("target_for_team"), // SM | VT
    fieldMappingId: text("field_mapping_id").references(() => fieldMapping.id, { onDelete: "set null" }),
    chatSessionId: text("chat_session_id"),
    schemaAssetIds: text("schema_asset_ids", { mode: "json" }).$type<string[]>(),
    assigneeIds: text("assignee_ids", { mode: "json" }).$type<string[]>(),
    // Threaded question fields
    resolvedBy: text("resolved_by").references(() => user.id, { onDelete: "set null" }),
    resolvedByName: text("resolved_by_name"),
    resolvedAt: text("resolved_at"),
    replyCount: integer("reply_count").notNull().default(0),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull().default(nowDefault),
    updatedAt: text("updated_at").notNull().default(nowDefault),
  },
  (table) => [
    index("question_workspace_idx").on(table.workspaceId),
    index("question_entity_idx").on(table.entityId),
    index("question_status_idx").on(table.workspaceId, table.status),
    index("question_team_idx").on(table.targetForTeam, table.status),
  ]
);

export const questionReply = sqliteTable(
  "question_reply",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    questionId: text("question_id")
      .notNull()
      .references(() => question.id, { onDelete: "cascade" }),
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    authorName: text("author_name").notNull(),
    authorRole: text("author_role").notNull().default("user"), // user | llm | system
    body: text("body").notNull(),
    isResolution: integer("is_resolution", { mode: "boolean" }).notNull().default(false),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    editedAt: text("edited_at"),
    createdAt: text("created_at").notNull().default(nowDefault),
  },
  (table) => [
    index("question_reply_question_idx").on(table.questionId),
    index("question_reply_question_created_idx").on(table.questionId, table.createdAt),
  ]
);

export const generation = sqliteTable(
  "generation",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    entityId: text("entity_id").references(() => entity.id, { onDelete: "set null" }),
    generationType: text("generation_type").notNull(),
    // field_mapping | enum_mapping | entity_review | question_generation
    status: text("status").notNull().default("pending"), // pending | running | completed | failed
    provider: text("provider"),
    model: text("model"),
    promptSnapshot: text("prompt_snapshot", { mode: "json" }).$type<{
      systemMessage: string;
      userMessage: string;
      skillsUsed: string[];
    }>(),
    output: text("output"),
    outputParsed: text("output_parsed", { mode: "json" }).$type<Record<string, unknown>>(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    durationMs: integer("duration_ms"),
    error: text("error"),
    validationScore: integer("validation_score"),
    validationIssues: text("validation_issues", { mode: "json" }).$type<Record<string, unknown>[]>(),
    batchRunId: text("batch_run_id"),
    createdAt: text("created_at").notNull().default(nowDefault),
    updatedAt: text("updated_at").notNull().default(nowDefault),
  },
  (table) => [
    index("generation_workspace_idx").on(table.workspaceId),
    index("generation_entity_idx").on(table.entityId),
    index("generation_status_idx").on(table.status),
    index("generation_batch_run_idx").on(table.batchRunId),
  ]
);

export const skill = sqliteTable(
  "skill",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    instructions: text("instructions"),
    applicability: text("applicability", { mode: "json" }).$type<{
      entityPatterns?: string[];
      fieldPatterns?: string[];
      dataTypes?: string[];
      subcategories?: string[];
    }>(),
    tags: text("tags", { mode: "json" }).$type<string[]>(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull().default(nowDefault),
    updatedAt: text("updated_at").notNull().default(nowDefault),
  },
  (table) => [
    index("skill_workspace_idx").on(table.workspaceId),
  ]
);

export const skillContext = sqliteTable(
  "skill_context",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    skillId: text("skill_id")
      .notNull()
      .references(() => skill.id, { onDelete: "cascade" }),
    contextId: text("context_id")
      .notNull()
      .references(() => context.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("reference"), // primary | reference | supplementary
    sortOrder: integer("sort_order").notNull().default(0),
    notes: text("notes"),
    createdAt: text("created_at").notNull().default(nowDefault),
  },
  (table) => [
    index("skill_context_skill_idx").on(table.skillId),
    index("skill_context_context_idx").on(table.contextId),
  ]
);

export const batchRun = sqliteTable(
  "batch_run",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"), // pending | running | completed | failed
    totalEntities: integer("total_entities").notNull().default(0),
    completedEntities: integer("completed_entities").notNull().default(0),
    failedEntities: integer("failed_entities").notNull().default(0),
    totalFields: integer("total_fields").notNull().default(0),
    completedFields: integer("completed_fields").notNull().default(0),
    currentEntityName: text("current_entity_name"),
    config: text("config", { mode: "json" }).$type<{
      provider?: string;
      model?: string;
      skipAlreadyMapped?: boolean;
      includeStatuses?: string[];
    }>(),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: text("created_at").notNull().default(nowDefault),
    updatedAt: text("updated_at").notNull().default(nowDefault),
  },
  (table) => [
    index("batch_run_workspace_idx").on(table.workspaceId),
    index("batch_run_status_idx").on(table.status),
  ]
);

export const chatSession = sqliteTable(
  "chat_session",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    fieldMappingId: text("field_mapping_id").references(() => fieldMapping.id, { onDelete: "set null" }),
    targetFieldId: text("target_field_id").references(() => field.id, { onDelete: "set null" }),
    entityId: text("entity_id").references(() => entity.id, { onDelete: "set null" }),
    status: text("status").notNull().default("active"), // active | resolved | abandoned
    messageCount: integer("message_count").notNull().default(0),
    lastMessageAt: text("last_message_at"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: text("created_at").notNull().default(nowDefault),
    updatedAt: text("updated_at").notNull().default(nowDefault),
  },
  (table) => [
    index("chat_session_workspace_idx").on(table.workspaceId),
    index("chat_session_mapping_idx").on(table.fieldMappingId),
    index("chat_session_status_idx").on(table.status),
  ]
);

export const chatMessage = sqliteTable(
  "chat_message",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    sessionId: text("session_id")
      .notNull()
      .references(() => chatSession.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // user | assistant | system
    content: text("content").notNull(),
    metadata: text("metadata", { mode: "json" }).$type<{
      tokens?: number;
      model?: string;
      provider?: string;
      mappingUpdate?: Record<string, unknown>;
      voiceInput?: boolean;
    }>(),
    createdAt: text("created_at").notNull().default(nowDefault),
  },
  (table) => [
    index("chat_message_session_idx").on(table.sessionId),
    index("chat_message_session_created_idx").on(table.sessionId, table.createdAt),
  ]
);

export const learning = sqliteTable(
  "learning",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    entityId: text("entity_id").references(() => entity.id, { onDelete: "set null" }),
    fieldName: text("field_name"),
    scope: text("scope").notNull(), // "field" | "entity" | "workspace"
    content: text("content").notNull(),
    source: text("source").notNull(), // "training" | "review" | "manual"
    sessionId: text("session_id"),
    createdAt: text("created_at").notNull().default(nowDefault),
  },
  (table) => [
    index("learning_workspace_idx").on(table.workspaceId),
    index("learning_entity_idx").on(table.entityId),
    index("learning_scope_idx").on(table.scope),
  ]
);

export const entityPipeline = sqliteTable(
  "entity_pipeline",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    entityId: text("entity_id")
      .notNull()
      .references(() => entity.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    parentId: text("parent_id"),
    isLatest: integer("is_latest", { mode: "boolean" }).notNull().default(true),
    yamlSpec: text("yaml_spec").notNull(),
    tableName: text("table_name").notNull(),
    primaryKey: text("primary_key", { mode: "json" }).$type<string[]>(),
    sources: text("sources", { mode: "json" }).$type<{
      name: string;
      alias: string;
      table: string;
      filters?: Record<string, unknown>[];
    }[]>().notNull(),
    joins: text("joins", { mode: "json" }).$type<{
      left: string;
      right: string;
      on: string[];
      how: string;
    }[] | null>(),
    concat: text("concat", { mode: "json" }).$type<Record<string, unknown> | null>(),
    structureType: text("structure_type").notNull().default("flat"), // flat | assembly
    isStale: integer("is_stale", { mode: "boolean" }).notNull().default(false),
    generationId: text("generation_id"),
    batchRunId: text("batch_run_id"),
    editedBy: text("edited_by"),
    changeSummary: text("change_summary"),
    createdAt: text("created_at").notNull().default(nowDefault),
    updatedAt: text("updated_at").notNull().default(nowDefault),
  },
  (table) => [
    index("entity_pipeline_workspace_idx").on(table.workspaceId),
    index("entity_pipeline_entity_idx").on(table.entityId),
    index("entity_pipeline_latest_idx").on(table.entityId, table.isLatest),
  ]
);

export const activity = sqliteTable(
  "activity",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    fieldMappingId: text("field_mapping_id"),
    entityId: text("entity_id"),
    actorId: text("actor_id"),
    actorName: text("actor_name").notNull(),
    action: text("action").notNull(), // status_change | comment_added | thread_created | thread_resolved | mapping_saved | validation_ran | case_closed | case_reopened
    detail: text("detail", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: text("created_at").notNull().default(nowDefault),
  },
  (table) => [
    index("activity_field_mapping_idx").on(table.fieldMappingId),
    index("activity_entity_idx").on(table.entityId),
    index("activity_workspace_created_idx").on(table.workspaceId, table.createdAt),
  ]
);

export const validation = sqliteTable(
  "validation",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    fieldMappingId: text("field_mapping_id")
      .notNull()
      .references(() => fieldMapping.id, { onDelete: "cascade" }),
    entityId: text("entity_id"),
    status: text("status").notNull(), // passed | failed | error
    input: text("input", { mode: "json" }).$type<Record<string, unknown>>(),
    output: text("output", { mode: "json" }).$type<Record<string, unknown>>(),
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms"),
    ranBy: text("ran_by"),
    createdAt: text("created_at").notNull().default(nowDefault),
  },
  (table) => [
    index("validation_field_mapping_idx").on(table.fieldMappingId),
    index("validation_workspace_idx").on(table.workspaceId),
  ]
);

// ─── Relations ────────────────────────────────────────────────

export const workspaceRelations = relations(workspace, ({ many }) => ({
  schemaAssets: many(schemaAsset),
  entities: many(entity),
  fieldMappings: many(fieldMapping),
  contexts: many(context),
  skills: many(skill),
  questions: many(question),
  generations: many(generation),
  commentThreads: many(commentThread),
  userWorkspaces: many(userWorkspace),
  batchRuns: many(batchRun),
  chatSessions: many(chatSession),
  learnings: many(learning),
}));

export const schemaAssetRelations = relations(schemaAsset, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [schemaAsset.workspaceId],
    references: [workspace.id],
  }),
  entities: many(entity),
}));

export const entityRelations = relations(entity, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [entity.workspaceId],
    references: [workspace.id],
  }),
  schemaAsset: one(schemaAsset, {
    fields: [entity.schemaAssetId],
    references: [schemaAsset.id],
  }),
  parent: one(entity, {
    fields: [entity.parentEntityId],
    references: [entity.id],
    relationName: "entityHierarchy",
  }),
  children: many(entity, { relationName: "entityHierarchy" }),
  fields: many(field),
  contexts: many(context),
  questions: many(question),
  generations: many(generation),
  commentThreads: many(commentThread),
  pipelines: many(entityPipeline),
}));

export const fieldRelations = relations(field, ({ one, many }) => ({
  entity: one(entity, {
    fields: [field.entityId],
    references: [entity.id],
  }),
  mappingsAsTarget: many(fieldMapping, { relationName: "targetField" }),
  mappingsAsSource: many(fieldMapping, { relationName: "sourceField" }),
  questions: many(question),
  contexts: many(context),
}));

export const fieldMappingRelations = relations(fieldMapping, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [fieldMapping.workspaceId],
    references: [workspace.id],
  }),
  targetField: one(field, {
    fields: [fieldMapping.targetFieldId],
    references: [field.id],
    relationName: "targetField",
  }),
  sourceEntity: one(entity, {
    fields: [fieldMapping.sourceEntityId],
    references: [entity.id],
  }),
  sourceField: one(field, {
    fields: [fieldMapping.sourceFieldId],
    references: [field.id],
    relationName: "sourceField",
  }),
  generation: one(generation, {
    fields: [fieldMapping.generationId],
    references: [generation.id],
  }),
  parent: one(fieldMapping, {
    fields: [fieldMapping.parentId],
    references: [fieldMapping.id],
    relationName: "mappingVersions",
  }),
  contexts: many(mappingContext),
  commentThreads: many(commentThread),
}));

export const contextRelations = relations(context, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [context.workspaceId],
    references: [workspace.id],
  }),
  entity: one(entity, {
    fields: [context.entityId],
    references: [entity.id],
  }),
  field: one(field, {
    fields: [context.fieldId],
    references: [field.id],
  }),
  contextReferences: many(mappingContext),
  skillContexts: many(skillContext),
}));

export const mappingContextRelations = relations(mappingContext, ({ one }) => ({
  fieldMapping: one(fieldMapping, {
    fields: [mappingContext.fieldMappingId],
    references: [fieldMapping.id],
  }),
  context: one(context, {
    fields: [mappingContext.contextId],
    references: [context.id],
  }),
}));

export const commentThreadRelations = relations(commentThread, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [commentThread.workspaceId],
    references: [workspace.id],
  }),
  entity: one(entity, {
    fields: [commentThread.entityId],
    references: [entity.id],
  }),
  fieldMapping: one(fieldMapping, {
    fields: [commentThread.fieldMappingId],
    references: [fieldMapping.id],
  }),
  comments: many(comment),
}));

export const commentRelations = relations(comment, ({ one }) => ({
  thread: one(commentThread, {
    fields: [comment.threadId],
    references: [commentThread.id],
  }),
}));

export const questionRelations = relations(question, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [question.workspaceId],
    references: [workspace.id],
  }),
  entity: one(entity, {
    fields: [question.entityId],
    references: [entity.id],
  }),
  field: one(field, {
    fields: [question.fieldId],
    references: [field.id],
  }),
  resolvedByUser: one(user, {
    fields: [question.resolvedBy],
    references: [user.id],
  }),
  replies: many(questionReply),
}));

export const questionReplyRelations = relations(questionReply, ({ one }) => ({
  question: one(question, {
    fields: [questionReply.questionId],
    references: [question.id],
  }),
  author: one(user, {
    fields: [questionReply.authorId],
    references: [user.id],
  }),
}));

export const generationRelations = relations(generation, ({ one }) => ({
  workspace: one(workspace, {
    fields: [generation.workspaceId],
    references: [workspace.id],
  }),
  entity: one(entity, {
    fields: [generation.entityId],
    references: [entity.id],
  }),
}));

export const skillRelations = relations(skill, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [skill.workspaceId],
    references: [workspace.id],
  }),
  skillContexts: many(skillContext),
}));

export const skillContextRelations = relations(skillContext, ({ one }) => ({
  skill: one(skill, {
    fields: [skillContext.skillId],
    references: [skill.id],
  }),
  context: one(context, {
    fields: [skillContext.contextId],
    references: [context.id],
  }),
}));

export const batchRunRelations = relations(batchRun, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [batchRun.workspaceId],
    references: [workspace.id],
  }),
  createdByUser: one(user, {
    fields: [batchRun.createdBy],
    references: [user.id],
  }),
}));

export const chatSessionRelations = relations(chatSession, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [chatSession.workspaceId],
    references: [workspace.id],
  }),
  fieldMapping: one(fieldMapping, {
    fields: [chatSession.fieldMappingId],
    references: [fieldMapping.id],
  }),
  targetField: one(field, {
    fields: [chatSession.targetFieldId],
    references: [field.id],
  }),
  entity: one(entity, {
    fields: [chatSession.entityId],
    references: [entity.id],
  }),
  messages: many(chatMessage),
}));

export const chatMessageRelations = relations(chatMessage, ({ one }) => ({
  session: one(chatSession, {
    fields: [chatMessage.sessionId],
    references: [chatSession.id],
  }),
}));

export const learningRelations = relations(learning, ({ one }) => ({
  workspace: one(workspace, {
    fields: [learning.workspaceId],
    references: [workspace.id],
  }),
  entity: one(entity, {
    fields: [learning.entityId],
    references: [entity.id],
  }),
}));

export const entityPipelineRelations = relations(entityPipeline, ({ one }) => ({
  workspace: one(workspace, {
    fields: [entityPipeline.workspaceId],
    references: [workspace.id],
  }),
  entity: one(entity, {
    fields: [entityPipeline.entityId],
    references: [entity.id],
  }),
}));

// ─── Auth Relations ──────────────────────────────────────────

export const userRelations = relations(user, ({ many }) => ({
  accounts: many(account),
  userWorkspaces: many(userWorkspace),
  apiKeys: many(userApiKey),
  bigqueryTokens: many(userBigqueryToken),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const userWorkspaceRelations = relations(userWorkspace, ({ one }) => ({
  user: one(user, {
    fields: [userWorkspace.userId],
    references: [user.id],
  }),
  workspace: one(workspace, {
    fields: [userWorkspace.workspaceId],
    references: [workspace.id],
  }),
}));

export const userApiKeyRelations = relations(userApiKey, ({ one }) => ({
  user: one(user, {
    fields: [userApiKey.userId],
    references: [user.id],
  }),
}));

export const userBigqueryTokenRelations = relations(userBigqueryToken, ({ one }) => ({
  user: one(user, {
    fields: [userBigqueryToken.userId],
    references: [user.id],
  }),
}));

export const workspaceInviteRelations = relations(workspaceInvite, ({ one }) => ({
  workspace: one(workspace, {
    fields: [workspaceInvite.workspaceId],
    references: [workspace.id],
  }),
}));
