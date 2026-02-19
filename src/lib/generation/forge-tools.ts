import type { ToolDefinition } from "@/lib/llm/provider";
import { db } from "@/lib/db";
import { context, skill, skillContext, field, entity, fieldMapping } from "@/lib/db/schema";
import { eq, and, like, inArray } from "drizzle-orm";
import { searchContextsFts } from "@/lib/rag/fts5-search";

// ─── Tool Definitions ─────────────────────────────────────────

export function getForgeToolDefinitions(opts?: { entityId?: string }): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    {
      name: "search_contexts",
      description:
        "Full-text keyword search across the context library. Returns ranked matches with IDs, names, categories, token counts, and content previews. Use this to discover relevant contexts for a skill.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description:
              "Keywords to search for. Examples: 'borrower demographics', 'escrow disbursement', 'LOANINFO ENUMS'",
          },
          limit: {
            type: "number",
            description: "Max results to return (default 15, max 30)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "browse_contexts",
      description:
        "Browse the context library by category and subcategory without keywords. " +
        "Use this to understand what's available in a particular area of the context library.",
      inputSchema: {
        type: "object" as const,
        properties: {
          category: {
            type: "string",
            description: "Filter by category: 'foundational', 'schema', or 'adhoc'",
          },
          subcategory: {
            type: "string",
            description:
              "Filter by subcategory: 'domain_knowledge', 'business_rules', 'data_dictionary', 'enum_map', 'code_breaker', etc.",
          },
          nameFilter: {
            type: "string",
            description: "Optional substring filter on context name (case-insensitive)",
          },
          limit: {
            type: "number",
            description: "Max results to return (default 30, max 60)",
          },
        },
        required: [],
      },
    },
    {
      name: "read_context",
      description:
        "Read the full content of a specific context by its ID. Use after searching or browsing to inspect a context's content before deciding whether to include it in a skill.",
      inputSchema: {
        type: "object" as const,
        properties: {
          contextId: {
            type: "string",
            description: "The context ID to read",
          },
        },
        required: ["contextId"],
      },
    },
    {
      name: "list_target_fields",
      description:
        "List all target entity fields with their types and descriptions. Use to understand what the skill needs to support mapping for.",
      inputSchema: {
        type: "object" as const,
        properties: {
          entityName: {
            type: "string",
            description: "Target entity name (case-insensitive substring match)",
          },
        },
        required: ["entityName"],
      },
    },
    {
      name: "get_existing_skill",
      description:
        "Read a skill's full configuration including all context assignments with roles and token counts. Use when refining an existing skill.",
      inputSchema: {
        type: "object" as const,
        properties: {
          skillId: {
            type: "string",
            description: "The skill ID to read",
          },
        },
        required: ["skillId"],
      },
    },
    {
      name: "list_skills",
      description:
        "List all skills with names, entity patterns, and context counts. Optionally filter by name.",
      inputSchema: {
        type: "object" as const,
        properties: {
          nameFilter: {
            type: "string",
            description: "Optional substring filter on skill name (case-insensitive)",
          },
        },
        required: [],
      },
    },
  ];

  if (opts?.entityId) {
    tools.push({
      name: "get_mapping_feedback",
      description:
        "Get feedback on how well the current skill performed for mapping. Returns confidence distribution, status distribution, unmapped fields, and details of low/medium confidence fields with reasoning. Use this FIRST when refining an existing skill to understand what needs improvement.",
      inputSchema: {
        type: "object" as const,
        properties: {
          entityId: {
            type: "string",
            description: "The target entity ID to get mapping feedback for",
          },
        },
        required: ["entityId"],
      },
    });
  }

  return tools;
}

// ─── Client Data Types (for inline UI cards) ─────────────────

export interface ContextPreview {
  id: string;
  name: string;
  category: string;
  subcategory?: string;
  tokenCount: number | null;
  preview: string; // ~300 chars, header-skipped
}

export interface ContextDetailPreview {
  id: string;
  name: string;
  category: string;
  subcategory?: string;
  tokenCount: number | null;
  tags: string[];
  truncated: boolean;
}

export interface SkillPreview {
  id: string;
  name: string;
  entityPatterns: string[];
  contextCount: number;
  isActive: boolean;
}

export interface SkillDetailPreview {
  id: string;
  name: string;
  description?: string;
  entityPatterns: string[];
  contextsByRole: { primary: number; reference: number; supplementary: number };
  totalTokens: number;
}

export interface MappingFeedbackPreview {
  entityName: string;
  totalFields: number;
  mapped: number;
  unmapped: number;
  confidence: { high: number; medium: number; low: number; unknown: number };
  problemFieldCount: number;
}

export type ForgeClientData =
  | { type: "contexts"; items: ContextPreview[] }
  | { type: "context_detail"; item: ContextDetailPreview }
  | { type: "skills"; items: SkillPreview[] }
  | { type: "skill_detail"; item: SkillDetailPreview }
  | { type: "fields"; entityName: string; fieldCount: number }
  | { type: "mapping_feedback"; summary: MappingFeedbackPreview };

// ─── Tool Executors ───────────────────────────────────────────

export interface ForgeToolResult {
  success: boolean;
  toolName: string;
  data: string; // Formatted for LLM consumption
  summary: string; // Short summary for SSE client event
  clientData?: ForgeClientData; // Structured data for UI cards
}

export function executeForgeToolCall(
  toolName: string,
  input: Record<string, unknown>,
  workspaceId: string
): ForgeToolResult {
  switch (toolName) {
    case "search_contexts":
      return executeSearchContexts(input, workspaceId);
    case "browse_contexts":
      return executeBrowseContexts(input, workspaceId);
    case "read_context":
      return executeReadContext(input, workspaceId);
    case "list_target_fields":
      return executeListTargetFields(input, workspaceId);
    case "get_existing_skill":
      return executeGetExistingSkill(input);
    case "list_skills":
      return executeListSkills(input, workspaceId);
    case "get_mapping_feedback":
      return executeMappingFeedback(input, workspaceId);
    default:
      return {
        success: false,
        toolName,
        data: `Unknown forge tool: ${toolName}`,
        summary: `Unknown tool: ${toolName}`,
      };
  }
}

function executeSearchContexts(
  input: Record<string, unknown>,
  workspaceId: string
): ForgeToolResult {
  const query = input.query as string;
  const limit = Math.min((input.limit as number) || 15, 30);

  const ftsResults = searchContextsFts(workspaceId, query, limit);

  if (ftsResults.length === 0) {
    return {
      success: true,
      toolName: "search_contexts",
      data: `No contexts matched "${query}". Try different keywords.`,
      summary: `No results for "${query}"`,
      clientData: { type: "contexts", items: [] },
    };
  }

  // Load full context records for previews
  const contextIds = ftsResults.map((r) => r.contextId);
  const contexts = db
    .select({
      id: context.id,
      name: context.name,
      category: context.category,
      subcategory: context.subcategory,
      tokenCount: context.tokenCount,
      content: context.content,
    })
    .from(context)
    .where(inArray(context.id, contextIds))
    .all();

  const contextMap = new Map(contexts.map((c) => [c.id, c]));

  const lines: string[] = [];
  lines.push(`Found ${ftsResults.length} context(s) for "${query}":\n`);
  lines.push("| # | ID | Name | Category | Tokens | Preview |");
  lines.push("| - | -- | ---- | -------- | ------ | ------- |");

  for (let i = 0; i < ftsResults.length; i++) {
    const fts = ftsResults[i];
    const ctx = contextMap.get(fts.contextId);
    if (!ctx) continue;

    const rawContent = ctx.content || "";
    // Skip leading markdown headers and blank lines for a more useful preview
    const contentLines = rawContent.split("\n");
    let startIdx = 0;
    while (startIdx < contentLines.length && (contentLines[startIdx].startsWith("#") || contentLines[startIdx].trim() === "")) {
      startIdx++;
    }
    const preview = contentLines.slice(startIdx).join(" ").slice(0, 500).trim();
    const cat = [ctx.category, ctx.subcategory].filter(Boolean).join(" > ");
    lines.push(
      `| ${i + 1} | ${ctx.id} | ${ctx.name} | ${cat} | ${ctx.tokenCount || "?"} | ${preview}... |`
    );
  }

  // Build client data for UI cards
  const clientItems: ContextPreview[] = [];
  for (const fts of ftsResults) {
    const ctx = contextMap.get(fts.contextId);
    if (!ctx) continue;
    const rawContent = ctx.content || "";
    const contentLines2 = rawContent.split("\n");
    let si = 0;
    while (si < contentLines2.length && (contentLines2[si].startsWith("#") || contentLines2[si].trim() === "")) {
      si++;
    }
    clientItems.push({
      id: ctx.id,
      name: ctx.name,
      category: ctx.category,
      subcategory: ctx.subcategory || undefined,
      tokenCount: ctx.tokenCount,
      preview: contentLines2.slice(si).join(" ").slice(0, 300).trim(),
    });
  }

  return {
    success: true,
    toolName: "search_contexts",
    data: lines.join("\n"),
    summary: `Found ${ftsResults.length} contexts for "${query}"`,
    clientData: { type: "contexts", items: clientItems },
  };
}

function executeBrowseContexts(
  input: Record<string, unknown>,
  workspaceId: string
): ForgeToolResult {
  const category = input.category as string | undefined;
  const subcategory = input.subcategory as string | undefined;
  const nameFilter = input.nameFilter as string | undefined;
  const limit = Math.min((input.limit as number) || 30, 60);

  const conditions = [
    eq(context.workspaceId, workspaceId),
    eq(context.isActive, true),
  ];
  if (category) conditions.push(eq(context.category, category));
  if (subcategory) conditions.push(eq(context.subcategory, subcategory));
  if (nameFilter) conditions.push(like(context.name, `%${nameFilter}%`));

  const results = db
    .select({
      id: context.id,
      name: context.name,
      category: context.category,
      subcategory: context.subcategory,
      tokenCount: context.tokenCount,
    })
    .from(context)
    .where(and(...conditions))
    .orderBy(context.name)
    .limit(limit)
    .all();

  // Also get total count for context
  const totalCount = db
    .select({ id: context.id })
    .from(context)
    .where(and(...conditions))
    .all().length;

  if (results.length === 0) {
    const filters = [category, subcategory, nameFilter].filter(Boolean).join(", ");
    return {
      success: true,
      toolName: "browse_contexts",
      data: `No contexts found${filters ? ` for filters: ${filters}` : ""}. Try broader filters.`,
      summary: "No contexts found",
      clientData: { type: "contexts", items: [] },
    };
  }

  const lines: string[] = [];
  const showing = totalCount > limit ? `${limit} of ${totalCount}` : `${results.length}`;
  lines.push(`Browsing ${showing} context(s):\n`);
  lines.push("| # | ID | Name | Category | Tokens |");
  lines.push("| - | -- | ---- | -------- | ------ |");

  for (let i = 0; i < results.length; i++) {
    const ctx = results[i];
    const cat = [ctx.category, ctx.subcategory].filter(Boolean).join(" > ");
    lines.push(
      `| ${i + 1} | ${ctx.id} | ${ctx.name} | ${cat} | ${ctx.tokenCount || "?"} |`
    );
  }

  const browseClientItems: ContextPreview[] = results.map((ctx) => ({
    id: ctx.id,
    name: ctx.name,
    category: ctx.category,
    subcategory: ctx.subcategory || undefined,
    tokenCount: ctx.tokenCount,
    preview: "", // Browse doesn't load content
  }));

  return {
    success: true,
    toolName: "browse_contexts",
    data: lines.join("\n"),
    summary: `Browsed ${showing} contexts`,
    clientData: { type: "contexts", items: browseClientItems },
  };
}

function executeReadContext(
  input: Record<string, unknown>,
  workspaceId: string
): ForgeToolResult {
  const contextId = input.contextId as string;

  const ctx = db
    .select()
    .from(context)
    .where(eq(context.id, contextId))
    .get();

  if (!ctx) {
    return {
      success: false,
      toolName: "read_context",
      data: `Context ${contextId} not found.`,
      summary: "Context not found",
    };
  }

  // Verify workspace access
  if (ctx.workspaceId !== workspaceId) {
    return {
      success: false,
      toolName: "read_context",
      data: "Context not accessible in this workspace.",
      summary: "Access denied",
    };
  }

  const content = ctx.content || "(empty)";
  const charLimit = 32_000; // ~8K tokens
  const truncated = content.length > charLimit;
  const displayContent = truncated
    ? content.slice(0, charLimit) + "\n\n[... truncated at 8K tokens]"
    : content;

  const meta = [
    `**Name**: ${ctx.name}`,
    `**Category**: ${ctx.category}${ctx.subcategory ? " > " + ctx.subcategory : ""}`,
    `**Tokens**: ${ctx.tokenCount || "unknown"}`,
    `**Tags**: ${ctx.tags?.join(", ") || "none"}`,
    truncated ? `**Note**: Content truncated (full: ${content.length} chars)` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    success: true,
    toolName: "read_context",
    data: `${meta}\n\n---\n\n${displayContent}`,
    summary: `Read "${ctx.name}" (${ctx.tokenCount || "?"} tokens)`,
    clientData: {
      type: "context_detail",
      item: {
        id: ctx.id,
        name: ctx.name,
        category: ctx.category,
        subcategory: ctx.subcategory || undefined,
        tokenCount: ctx.tokenCount,
        tags: ctx.tags || [],
        truncated,
      },
    },
  };
}

function executeListTargetFields(
  input: Record<string, unknown>,
  workspaceId: string
): ForgeToolResult {
  const entityName = (input.entityName as string).toLowerCase();

  // Find target entities matching the name
  const targetEntities = db
    .select({
      id: entity.id,
      name: entity.name,
      displayName: entity.displayName,
      description: entity.description,
    })
    .from(entity)
    .where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "target")))
    .all()
    .filter(
      (e) =>
        (e.displayName || e.name).toLowerCase().includes(entityName) ||
        e.name.toLowerCase().includes(entityName)
    );

  if (targetEntities.length === 0) {
    return {
      success: true,
      toolName: "list_target_fields",
      data: `No target entities matching "${entityName}" found.`,
      summary: "No matching entities",
    };
  }

  const lines: string[] = [];

  for (const te of targetEntities) {
    const fields = db
      .select({
        name: field.name,
        displayName: field.displayName,
        dataType: field.dataType,
        isRequired: field.isRequired,
        description: field.description,
      })
      .from(field)
      .where(eq(field.entityId, te.id))
      .orderBy(field.sortOrder)
      .all();

    const eName = te.displayName || te.name;
    lines.push(`## ${eName} (${fields.length} fields)`);
    if (te.description) lines.push(`_${te.description}_\n`);

    lines.push("| Field | Type | Required | Description |");
    lines.push("| ----- | ---- | -------- | ----------- |");

    for (const f of fields) {
      const desc = f.description
        ? f.description.length > 100
          ? f.description.slice(0, 100) + "..."
          : f.description
        : "";
      lines.push(
        `| ${f.displayName || f.name} | ${f.dataType || ""} | ${f.isRequired ? "Yes" : "No"} | ${desc} |`
      );
    }
    lines.push("");
  }

  const totalFields = targetEntities.reduce((sum, te) => {
    const count = db
      .select({ id: field.id })
      .from(field)
      .where(eq(field.entityId, te.id))
      .all().length;
    return sum + count;
  }, 0);

  const entityDisplayName = targetEntities.map((te) => te.displayName || te.name).join(", ");

  return {
    success: true,
    toolName: "list_target_fields",
    data: lines.join("\n"),
    summary: `Listed ${totalFields} fields for ${targetEntities.length} entity(ies)`,
    clientData: { type: "fields", entityName: entityDisplayName, fieldCount: totalFields },
  };
}

function executeGetExistingSkill(
  input: Record<string, unknown>
): ForgeToolResult {
  const skillId = input.skillId as string;

  const s = db.select().from(skill).where(eq(skill.id, skillId)).get();

  if (!s) {
    return {
      success: false,
      toolName: "get_existing_skill",
      data: `Skill ${skillId} not found.`,
      summary: "Skill not found",
    };
  }

  // Load context assignments
  const assignments = db
    .select({
      scId: skillContext.id,
      contextId: skillContext.contextId,
      role: skillContext.role,
      sortOrder: skillContext.sortOrder,
      notes: skillContext.notes,
      contextName: context.name,
      contextCategory: context.category,
      contextSubcategory: context.subcategory,
      contextTokenCount: context.tokenCount,
    })
    .from(skillContext)
    .innerJoin(context, eq(skillContext.contextId, context.id))
    .where(eq(skillContext.skillId, skillId))
    .orderBy(skillContext.sortOrder)
    .all();

  const app = s.applicability as {
    entityPatterns?: string[];
    fieldPatterns?: string[];
  } | null;

  const lines: string[] = [];
  lines.push(`## Skill: ${s.name}`);
  lines.push(`**ID**: ${s.id}`);
  if (s.description) lines.push(`**Description**: ${s.description}`);
  if (app?.entityPatterns?.length)
    lines.push(`**Entity Patterns**: ${app.entityPatterns.join(", ")}`);
  if (app?.fieldPatterns?.length)
    lines.push(`**Field Patterns**: ${app.fieldPatterns.join(", ")}`);
  if (s.instructions) lines.push(`**Instructions**: ${s.instructions}`);
  lines.push(`**Active**: ${s.isActive}`);
  lines.push("");

  // Group by role
  const byRole = { primary: [] as typeof assignments, reference: [] as typeof assignments, supplementary: [] as typeof assignments };
  for (const a of assignments) {
    const role = a.role as keyof typeof byRole;
    if (byRole[role]) byRole[role].push(a);
    else byRole.supplementary.push(a);
  }

  let totalTokens = 0;

  for (const [role, items] of Object.entries(byRole)) {
    if (items.length === 0) continue;
    const roleTotal = items.reduce((sum, i) => sum + (i.contextTokenCount || 0), 0);
    totalTokens += roleTotal;
    lines.push(`### ${role.charAt(0).toUpperCase() + role.slice(1)} (${items.length} contexts, ~${roleTotal} tokens)`);
    lines.push("| Context ID | Name | Category | Tokens |");
    lines.push("| ---------- | ---- | -------- | ------ |");
    for (const item of items) {
      const cat = [item.contextCategory, item.contextSubcategory].filter(Boolean).join(" > ");
      lines.push(`| ${item.contextId} | ${item.contextName} | ${cat} | ${item.contextTokenCount || "?"} |`);
    }
    lines.push("");
  }

  lines.push(`**Total Tokens**: ~${totalTokens}`);

  return {
    success: true,
    toolName: "get_existing_skill",
    data: lines.join("\n"),
    summary: `Read skill "${s.name}" (${assignments.length} contexts, ~${totalTokens} tokens)`,
    clientData: {
      type: "skill_detail",
      item: {
        id: s.id,
        name: s.name,
        description: s.description || undefined,
        entityPatterns: app?.entityPatterns || [],
        contextsByRole: {
          primary: byRole.primary.length,
          reference: byRole.reference.length,
          supplementary: byRole.supplementary.length,
        },
        totalTokens,
      },
    },
  };
}

function executeListSkills(
  input: Record<string, unknown>,
  workspaceId: string
): ForgeToolResult {
  const nameFilter = input.nameFilter as string | undefined;

  const conditions = [eq(skill.workspaceId, workspaceId)];
  if (nameFilter) conditions.push(like(skill.name, `%${nameFilter}%`));

  const skills = db
    .select({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      applicability: skill.applicability,
      isActive: skill.isActive,
    })
    .from(skill)
    .where(and(...conditions))
    .orderBy(skill.name)
    .all();

  if (skills.length === 0) {
    return {
      success: true,
      toolName: "list_skills",
      data: nameFilter
        ? `No skills matching "${nameFilter}" found.`
        : "No skills found in this workspace.",
      summary: "No skills found",
    };
  }

  const lines: string[] = [];
  lines.push(`Found ${skills.length} skill(s):\n`);
  lines.push("| # | ID | Name | Entity Patterns | Contexts | Active |");
  lines.push("| - | -- | ---- | --------------- | -------- | ------ |");

  for (let i = 0; i < skills.length; i++) {
    const s = skills[i];
    const app = s.applicability as { entityPatterns?: string[] } | null;
    const patterns = app?.entityPatterns?.join(", ") || "";

    // Count contexts
    const ctxCount = db
      .select({ id: skillContext.id })
      .from(skillContext)
      .where(eq(skillContext.skillId, s.id))
      .all().length;

    lines.push(
      `| ${i + 1} | ${s.id} | ${s.name} | ${patterns} | ${ctxCount} | ${s.isActive ? "Yes" : "No"} |`
    );
  }

  // Build client data with context counts already computed
  const skillClientItems: SkillPreview[] = skills.map((s) => {
    const app2 = s.applicability as { entityPatterns?: string[] } | null;
    const ctxCount = db
      .select({ id: skillContext.id })
      .from(skillContext)
      .where(eq(skillContext.skillId, s.id))
      .all().length;
    return {
      id: s.id,
      name: s.name,
      entityPatterns: app2?.entityPatterns || [],
      contextCount: ctxCount,
      isActive: s.isActive,
    };
  });

  return {
    success: true,
    toolName: "list_skills",
    data: lines.join("\n"),
    summary: `Listed ${skills.length} skills`,
    clientData: { type: "skills", items: skillClientItems },
  };
}

function executeMappingFeedback(
  input: Record<string, unknown>,
  workspaceId: string
): ForgeToolResult {
  const entityId = input.entityId as string;

  // Find the target entity
  const targetEntity = db
    .select({ id: entity.id, name: entity.name, displayName: entity.displayName })
    .from(entity)
    .where(eq(entity.id, entityId))
    .get();

  if (!targetEntity) {
    return {
      success: false,
      toolName: "get_mapping_feedback",
      data: `Entity ${entityId} not found.`,
      summary: "Entity not found",
    };
  }

  // Get all target fields for this entity
  const targetFields = db
    .select({ id: field.id, name: field.name, displayName: field.displayName })
    .from(field)
    .where(eq(field.entityId, entityId))
    .all();

  const fieldNames = new Map(targetFields.map((f) => [f.id, f.displayName || f.name]));

  // Get latest mappings for all target fields
  const mappings = db
    .select({
      id: fieldMapping.id,
      targetFieldId: fieldMapping.targetFieldId,
      status: fieldMapping.status,
      confidence: fieldMapping.confidence,
      reasoning: fieldMapping.reasoning,
      mappingType: fieldMapping.mappingType,
      sourceEntityId: fieldMapping.sourceEntityId,
      sourceFieldId: fieldMapping.sourceFieldId,
    })
    .from(fieldMapping)
    .where(
      and(
        eq(fieldMapping.workspaceId, workspaceId),
        eq(fieldMapping.isLatest, true)
      )
    )
    .all()
    .filter((m) => fieldNames.has(m.targetFieldId));

  const mappedFieldIds = new Set(mappings.map((m) => m.targetFieldId));
  const unmappedFields = targetFields.filter((f) => !mappedFieldIds.has(f.id));

  // Confidence distribution
  const confDist: Record<string, number> = { high: 0, medium: 0, low: 0, unknown: 0 };
  for (const m of mappings) {
    const c = m.confidence || "unknown";
    confDist[c] = (confDist[c] || 0) + 1;
  }

  // Status distribution
  const statusDist: Record<string, number> = {};
  for (const m of mappings) {
    statusDist[m.status] = (statusDist[m.status] || 0) + 1;
  }

  // Problem fields: low/medium confidence with details
  const problemFields = mappings
    .filter((m) => m.confidence === "low" || m.confidence === "medium")
    .map((m) => {
      const reasoning = m.reasoning
        ? m.reasoning.length > 300
          ? m.reasoning.slice(0, 300) + "..."
          : m.reasoning
        : "(no reasoning)";
      return {
        field: fieldNames.get(m.targetFieldId) || m.targetFieldId,
        confidence: m.confidence,
        status: m.status,
        mappingType: m.mappingType || "unknown",
        reasoning,
      };
    });

  const entityName = targetEntity.displayName || targetEntity.name;
  const lines: string[] = [];
  lines.push(`## Mapping Feedback: ${entityName}`);
  lines.push(`**Total target fields**: ${targetFields.length}`);
  lines.push(`**Mapped**: ${mappings.length} | **Unmapped**: ${unmappedFields.length}`);
  lines.push("");

  lines.push("### Confidence Distribution");
  for (const [conf, count] of Object.entries(confDist)) {
    if (count > 0) lines.push(`- **${conf}**: ${count}`);
  }
  lines.push("");

  lines.push("### Status Distribution");
  for (const [status, count] of Object.entries(statusDist)) {
    if (count > 0) lines.push(`- **${status}**: ${count}`);
  }
  lines.push("");

  if (unmappedFields.length > 0) {
    lines.push("### Unmapped Fields");
    for (const f of unmappedFields) {
      lines.push(`- ${f.displayName || f.name}`);
    }
    lines.push("");
  }

  if (problemFields.length > 0) {
    lines.push("### Low/Medium Confidence Fields");
    for (const pf of problemFields) {
      lines.push(`#### ${pf.field} (${pf.confidence}, ${pf.status})`);
      lines.push(`Type: ${pf.mappingType}`);
      lines.push(`Reasoning: ${pf.reasoning}`);
      lines.push("");
    }
  }

  if (mappings.length === 0 && unmappedFields.length === targetFields.length) {
    lines.push("**No mappings exist yet.** This entity has not been through a mapping run.");
  }

  return {
    success: true,
    toolName: "get_mapping_feedback",
    data: lines.join("\n"),
    summary: `Feedback: ${mappings.length} mapped, ${unmappedFields.length} unmapped, ${problemFields.length} low/medium confidence`,
    clientData: {
      type: "mapping_feedback",
      summary: {
        entityName,
        totalFields: targetFields.length,
        mapped: mappings.length,
        unmapped: unmappedFields.length,
        confidence: confDist as MappingFeedbackPreview["confidence"],
        problemFieldCount: problemFields.length,
      },
    },
  };
}
