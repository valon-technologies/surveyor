/**
 * Data-driven skill generator — derives skills from DB state instead of
 * hardcoded entity pairings. Uses scaffolds, pipelines, and field mappings
 * to determine source tables, then matches contexts by name patterns.
 *
 * Replaces: scripts/generate-mapping-skills.ts
 */

import { db, withTransaction } from "@/lib/db";
import {
  entity,
  field,
  context,
  skill,
  skillContext,
  entityScaffold,
  entityPipeline,
  fieldMapping,
} from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";

// ── Types ──────────────────────────────────────────────────────

export interface SkillGenerationResult {
  skillId: string;
  entityName: string;
  contextCount: number;
  created: boolean;
}

export interface RegenerateAllResult {
  total: number;
  created: number;
  skipped: number;
  contextLinks: number;
}

// ── VDS Name Overrides ─────────────────────────────────────────
// Edge cases where entity name doesn't map cleanly to VDS context name

const VDS_NAME_OVERRIDES: Record<string, string> = {
  property_insurance_period: "Property Insurance",
  property_insurance_company: "Mortgage Insurance Company",
  property_insurance_installment: "Mortgage Insurance Installment",
  arm_loan_info: "ARM",
  arm_rate_period: "ARM Rate Period",
  pre_foreclosure_state_process: "Pre Foreclosure State",
  non_borrower_loan_participant: "Non Borrower Participants",
  borrower_active_service_period: "Borrower Extensions",
  borrower_deceased: "Borrower Extensions",
  index_rate: "ARM Index Rate",
  mortgage_insurance: "Mortgage Insurance",
  mortgage_insurance_company: "Mortgage Insurance Company",
};

// ── Keyword → Mortgage Context Matching ────────────────────────
// Maps keywords (from entity name parts + domainTags) to substring
// patterns that match "Mortgage Servicing > ..." context names.

const MORTGAGE_KEYWORD_MAP: Record<string, string[]> = {
  escrow: ["Escrow"],
  respa: ["Escrow"],
  cfpb: ["Loss Mitigation Applications", "Escrow"],
  mers: ["MERS"],
  gse: ["Fannie Mae", "Freddie Mac"],
  fannie: ["Fannie Mae"],
  freddie: ["Freddie Mac"],
  ginnie: ["Ginnie Mae"],
  fha: ["FHA"],
  va: [" VA "], // space-padded to avoid matching other words
  usda: ["USDA"],
  pmi: ["Private Mortgage Insurance"],
  hpa: ["Private Mortgage Insurance"],
  mi_certificate: ["MI Certificates"],
  pii: ["Privacy Notices"],
  hmda: ["Credit Information"],
  ssn: ["Privacy Notices"],
  foreclosure: ["Foreclosure"],
  fc_status: ["Foreclosure"],
  judicial: ["Foreclosure"],
  bankruptcy: ["Bankruptcy"],
  chapter_7: ["Bankruptcy"],
  chapter_13: ["Bankruptcy"],
  scra: ["SCRA"],
  military: ["SCRA"],
  tcpa: ["TCPA"],
  loss_mit: ["Loss Mitigation"],
  loss_mitigation: ["Loss Mitigation"],
  forbearance: ["Loss Mitigation"],
  modification: ["Loss Mitigation"],
  force_placed: ["Force Placed Insurance"],
  credit_score: ["Credit Information"],
};

// ── SM Table Name Normalization ────────────────────────────────
// Converts source entity names like "LoanInfo" or "loan_info" to
// the spaced form used in context names: "Loan Info"

function sourceNameToContextLabel(name: string): string {
  // Handle special cases
  const SPECIAL: Record<string, string> = {
    StopsFlagsAndIndicators: "Stops Flags Indicators",
    Arm: "ARM",
    MbsPool: "MBS Pool",
    arm: "ARM",
    mbs_pool: "MBS Pool",
  };
  if (SPECIAL[name]) return SPECIAL[name];

  // CamelCase → spaced: "LoanInfo" → "Loan Info"
  if (/[A-Z]/.test(name) && !name.includes("_")) {
    return name.replace(/([a-z])([A-Z])/g, "$1 $2");
  }

  // snake_case → Title Case: "loan_info" → "Loan Info"
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Entity Name → VDS Context Matching ─────────────────────────

function entityNameToLabel(entityName: string): string {
  if (VDS_NAME_OVERRIDES[entityName]) return VDS_NAME_OVERRIDES[entityName];
  return entityName
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Context Lookup Helpers ─────────────────────────────────────

type CtxRow = { id: string; name: string; tokenCount: number | null };

function loadAllContexts(workspaceId: string): CtxRow[] {
  return db
    .select({ id: context.id, name: context.name, tokenCount: context.tokenCount })
    .from(context)
    .where(and(eq(context.workspaceId, workspaceId), eq(context.isActive, true)))
    .all();
}

function findCtxByExactName(contexts: CtxRow[], name: string): CtxRow | undefined {
  return contexts.find((c) => c.name === name);
}

function findVdsEntityCtx(contexts: CtxRow[], entityName: string): CtxRow | undefined {
  const label = entityNameToLabel(entityName);
  // Search for leaf match: "VDS > ... > {label}"
  const leafMatch = contexts.find(
    (c) => c.name.startsWith("VDS > ") && c.name.endsWith(` > ${label}`)
  );
  if (leafMatch) return leafMatch;
  // Category-level match: "VDS > {label}"
  return contexts.find((c) => c.name === `VDS > ${label}`);
}

function findVdsCategoryCtx(contexts: CtxRow[], entityName: string): CtxRow | undefined {
  const label = entityNameToLabel(entityName);
  const entityCtx = contexts.find(
    (c) => c.name.startsWith("VDS > ") && c.name.endsWith(` > ${label}`)
  );
  if (!entityCtx) return undefined;
  // "VDS > Core Loan > Loan" → "VDS > Core Loan"
  const parts = entityCtx.name.split(" > ");
  if (parts.length < 3) return undefined;
  const categoryName = `${parts[0]} > ${parts[1]}`;
  return findCtxByExactName(contexts, categoryName);
}

function findSmTableCtx(contexts: CtxRow[], sourceTableName: string): CtxRow | undefined {
  const label = sourceNameToContextLabel(sourceTableName);
  return findCtxByExactName(contexts, `ServiceMac > Tables > ${label}`);
}

function findSmEnumCtx(contexts: CtxRow[], sourceTableName: string): CtxRow | undefined {
  // Enum contexts use uppercase: "ServiceMac > Enums > LOANINFO ENUMS"
  const normalized = sourceTableName
    .replace(/([a-z])([A-Z])/g, "$1$2") // Keep CamelCase joined
    .replace(/_/g, "")
    .toUpperCase();
  return contexts.find(
    (c) => c.name.startsWith("ServiceMac > Enums > ") &&
      c.name.toUpperCase().includes(normalized)
  );
}

function findSmDomainCtxs(
  contexts: CtxRow[],
  domainTags: string[] | null
): CtxRow[] {
  if (!domainTags?.length) return [];
  const results: CtxRow[] = [];
  for (const tag of domainTags) {
    const label = tag
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    const match = contexts.find(
      (c) => c.name === `ServiceMac > Domains > ${label}`
    );
    if (match) results.push(match);
  }
  return results;
}

function findMortgageCtxs(
  contexts: CtxRow[],
  keywords: string[]
): CtxRow[] {
  const mortgageContexts = contexts.filter((c) =>
    c.name.startsWith("Mortgage Servicing > ")
  );
  const matched = new Map<string, CtxRow>();

  for (const keyword of keywords) {
    const patterns = MORTGAGE_KEYWORD_MAP[keyword];
    if (!patterns) continue;
    for (const pattern of patterns) {
      for (const ctx of mortgageContexts) {
        if (ctx.name.includes(pattern) && !matched.has(ctx.id)) {
          matched.set(ctx.id, ctx);
        }
      }
    }
  }

  return Array.from(matched.values());
}

function findQaCtxs(contexts: CtxRow[], entityName: string): CtxRow[] {
  const label = entityName
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return contexts.filter((c) => c.name.startsWith(`Mapping Q&A > ${label}`));
}

// ── Source Table Derivation ────────────────────────────────────
// Layered strategy: scaffold → pipeline → field mappings

function deriveSourceTables(
  workspaceId: string,
  entityId: string
): string[] {
  // Layer 1: Entity scaffold (richest source)
  const scaffold = db
    .select({
      sourceTables: entityScaffold.sourceTables,
      primarySources: entityScaffold.primarySources,
      secondarySources: entityScaffold.secondarySources,
    })
    .from(entityScaffold)
    .where(
      and(
        eq(entityScaffold.workspaceId, workspaceId),
        eq(entityScaffold.entityId, entityId),
      )
    )
    .get();

  if (scaffold?.sourceTables) {
    const tables = (scaffold.sourceTables as { name: string; role: string }[])
      .filter((t) => t.role === "primary" || t.role === "secondary")
      .map((t) => t.name);
    if (tables.length > 0) return tables;
  }

  // Fallback: combine primarySources + secondarySources
  if (scaffold?.primarySources || scaffold?.secondarySources) {
    const combined = [
      ...((scaffold.primarySources as string[]) ?? []),
      ...((scaffold.secondarySources as string[]) ?? []),
    ];
    if (combined.length > 0) return combined;
  }

  // Layer 2: Entity pipeline sources
  const pipeline = db
    .select({ sources: entityPipeline.sources })
    .from(entityPipeline)
    .where(
      and(
        eq(entityPipeline.workspaceId, workspaceId),
        eq(entityPipeline.entityId, entityId),
        eq(entityPipeline.isLatest, true),
      )
    )
    .get();

  if (pipeline?.sources) {
    const pipelineSources = (pipeline.sources as { name: string }[])
      .map((s) => s.name)
      .filter(Boolean);
    if (pipelineSources.length > 0) return pipelineSources;
  }

  // Layer 3: Field mapping sourceEntityId counts
  const targetFields = db
    .select({ id: field.id })
    .from(field)
    .where(eq(field.entityId, entityId))
    .all();

  if (targetFields.length > 0) {
    const fieldIds = targetFields.map((f) => f.id);
    // Count source entities across latest mappings for these fields
    const sourceEntityCounts = db
      .select({
        sourceEntityId: fieldMapping.sourceEntityId,
        cnt: sql<number>`COUNT(*)`,
      })
      .from(fieldMapping)
      .where(
        and(
          eq(fieldMapping.workspaceId, workspaceId),
          eq(fieldMapping.isLatest, true),
          sql`${fieldMapping.sourceEntityId} IS NOT NULL`,
          sql`${fieldMapping.targetFieldId} IN (${sql.join(
            fieldIds.map((id) => sql`${id}`),
            sql`, `
          )})`,
        )
      )
      .groupBy(fieldMapping.sourceEntityId)
      .orderBy(sql`COUNT(*) DESC`)
      .all();

    if (sourceEntityCounts.length > 0) {
      // Resolve entity names
      const sourceNames: string[] = [];
      for (const row of sourceEntityCounts) {
        if (!row.sourceEntityId) continue;
        const ent = db
          .select({ name: entity.name })
          .from(entity)
          .where(eq(entity.id, row.sourceEntityId))
          .get();
        if (ent) sourceNames.push(ent.name);
      }
      if (sourceNames.length > 0) return sourceNames;
    }
  }

  return [];
}

// ── Extract Keywords ───────────────────────────────────────────

function extractKeywords(entityName: string, domainTags: string[] | null): string[] {
  const parts = entityName.toLowerCase().split("_").filter(Boolean);
  const keywords = [...parts];

  // Add compound keywords
  if (parts.includes("loss") && parts.includes("mitigation")) {
    keywords.push("loss_mitigation", "loss_mit");
  }
  if (parts.includes("force") && parts.includes("placed")) {
    keywords.push("force_placed");
  }
  if (parts.includes("credit") && parts.includes("score")) {
    keywords.push("credit_score");
  }
  if (parts.includes("fc") && parts.includes("status")) {
    keywords.push("fc_status");
  }
  if (parts.includes("chapter") && parts.includes("7")) {
    keywords.push("chapter_7");
  }
  if (parts.includes("chapter") && parts.includes("13")) {
    keywords.push("chapter_13");
  }
  if (parts.includes("mi") && parts.includes("certificate")) {
    keywords.push("mi_certificate");
  }

  // Add domain tags as keywords
  if (domainTags) {
    for (const tag of domainTags) {
      keywords.push(...tag.toLowerCase().split(/[-_\s]+/).filter(Boolean));
      // Also add the full hyphenated tag for compound matching
      keywords.push(tag.toLowerCase().replace(/\s+/g, "_"));
    }
  }

  return [...new Set(keywords)];
}

// ── Core Generation Function ───────────────────────────────────

export function generateSkillForEntity(
  workspaceId: string,
  targetEntityId: string,
  allContexts?: CtxRow[]
): SkillGenerationResult | null {
  // Load target entity
  const targetEntity = db
    .select()
    .from(entity)
    .where(and(eq(entity.id, targetEntityId), eq(entity.workspaceId, workspaceId)))
    .get();

  if (!targetEntity || targetEntity.side !== "target") {
    return null;
  }

  // Load all contexts (reuse if provided)
  const contexts = allContexts ?? loadAllContexts(workspaceId);

  // 1. Find VDS entity context
  const vdsEntityCtx = findVdsEntityCtx(contexts, targetEntity.name);
  if (!vdsEntityCtx) {
    return null; // Can't generate skill without VDS context
  }

  // 2. Find VDS category context
  const vdsCategoryCtx = findVdsCategoryCtx(contexts, targetEntity.name);

  // 3. Derive source tables
  const sourceTables = deriveSourceTables(workspaceId, targetEntityId);

  // 4. Find SM table contexts
  const smTableCtxs: CtxRow[] = [];
  const smEnumCtxs: CtxRow[] = [];
  const seenEnumIds = new Set<string>();

  for (const tableName of sourceTables) {
    const tableCtx = findSmTableCtx(contexts, tableName);
    if (tableCtx) smTableCtxs.push(tableCtx);

    const enumCtx = findSmEnumCtx(contexts, tableName);
    if (enumCtx && !seenEnumIds.has(enumCtx.id)) {
      seenEnumIds.add(enumCtx.id);
      smEnumCtxs.push(enumCtx);
    }
  }

  // 5. Find SM domain contexts
  const smDomainCtxs = findSmDomainCtxs(contexts, targetEntity.domainTags);

  // 6. Find regulatory/mortgage contexts
  const keywords = extractKeywords(targetEntity.name, targetEntity.domainTags);
  const mortgageCtxs = findMortgageCtxs(contexts, keywords);

  // 7. Find Q&A contexts
  const qaCtxs = findQaCtxs(contexts, targetEntity.name);

  // Build skill metadata
  const label = entityNameToLabel(targetEntity.name);
  const smTableNames = sourceTables.length > 0
    ? sourceTables.map(sourceNameToContextLabel).join(", ")
    : "TBD";

  const description = `Maps ServiceMac data to VDS ${targetEntity.name} entity. Source tables: ${smTableNames}. Use when mapping ${targetEntity.name.replace(/_/g, " ")} fields.`;

  const sourceTableList = sourceTables.length > 0
    ? `### Source Tables\n${sourceTables.map((t) => `- **${sourceNameToContextLabel(t)}**`).join("\n")}`
    : "### Source Tables\nSee ServiceMac domain contexts for source data.";

  const instructions = `## Mapping: ${label}

${sourceTableList}

### Mapping Checklist
1. Map ALL fields listed in the VDS entity context — not just common ones
2. Verify every field name and data type against VDS schema CSV
3. ACDC dates are already YYYY-MM-DD — use SAFE_CAST, not PARSE_DATE
4. Skip system-generated fields (sid, created_at, updated_at, deleted_at)
5. Check the Mapping Decisions context for prior decisions about this entity
6. Document any open questions for fields that can't be mapped`;

  const applicability = {
    entityPatterns: [targetEntity.name, targetEntity.name.replace(/_/g, " ")],
  };

  const tags = ["mapping", targetEntity.name.replace(/_/g, "-")];

  // Upsert: delete existing skill with matching entity patterns, then create new
  const skillId = crypto.randomUUID();
  let contextCount = 0;

  withTransaction(() => {
    // Find and delete existing skill for this entity
    const existingSkills = db
      .select({ id: skill.id, applicability: skill.applicability })
      .from(skill)
      .where(eq(skill.workspaceId, workspaceId))
      .all();

    for (const existing of existingSkills) {
      const app = existing.applicability as { entityPatterns?: string[] } | null;
      if (app?.entityPatterns?.includes(targetEntity.name)) {
        db.delete(skillContext).where(eq(skillContext.skillId, existing.id)).run();
        db.delete(skill).where(eq(skill.id, existing.id)).run();
      }
    }

    // Create new skill
    db.insert(skill)
      .values({
        id: skillId,
        workspaceId,
        name: `Mapping: ${label}`,
        description,
        instructions,
        applicability,
        tags,
        isActive: true,
        sortOrder: 0,
      })
      .run();

    let ctxOrder = 0;

    // Helper to link a context
    const linkCtx = (ctxId: string, role: string, notes: string) => {
      db.insert(skillContext)
        .values({
          skillId,
          contextId: ctxId,
          role,
          sortOrder: ctxOrder++,
          notes,
        })
        .run();
      contextCount++;
    };

    // 1. VDS entity (primary)
    linkCtx(vdsEntityCtx.id, "primary",
      `VDS ${targetEntity.name} entity definition — fields, enums, mapping patterns`);

    // 2. SM tables (primary)
    for (const ctx of smTableCtxs) {
      linkCtx(ctx.id, "primary", `ServiceMac source table — ${ctx.name}`);
    }

    // 3. SM enum contexts (reference)
    for (const ctx of smEnumCtxs) {
      linkCtx(ctx.id, "reference",
        `ServiceMac enum values — authoritative code definitions from Lookups tab`);
    }

    // 4. SM domains (reference)
    for (const ctx of smDomainCtxs) {
      linkCtx(ctx.id, "reference", `ServiceMac domain — cross-table mapping guide`);
    }

    // 5. VDS category overview (reference)
    if (vdsCategoryCtx) {
      linkCtx(vdsCategoryCtx.id, "reference",
        "VDS category overview — related entities and navigation");
    }

    // 6. Mortgage domain contexts (supplementary)
    for (const ctx of mortgageCtxs) {
      linkCtx(ctx.id, "supplementary", `Regulatory context: ${ctx.name}`);
    }

    // 7. Q&A contexts (reference)
    for (const ctx of qaCtxs) {
      linkCtx(ctx.id, "reference", `Prior Q&A: ${ctx.name}`);
    }
  });

  return {
    skillId,
    entityName: targetEntity.name,
    contextCount,
    created: true,
  };
}

// ── Bulk Regeneration ──────────────────────────────────────────

export function regenerateAllSkills(workspaceId: string): RegenerateAllResult {
  // Load all target entities
  const targetEntities = db
    .select({ id: entity.id, name: entity.name })
    .from(entity)
    .where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "target")))
    .orderBy(entity.sortOrder)
    .all();

  // Pre-load all contexts once for efficiency
  const allContexts = loadAllContexts(workspaceId);

  // Clean slate: delete all existing skills + links for this workspace
  withTransaction(() => {
    const existingSkills = db
      .select({ id: skill.id })
      .from(skill)
      .where(eq(skill.workspaceId, workspaceId))
      .all();

    for (const s of existingSkills) {
      db.delete(skillContext).where(eq(skillContext.skillId, s.id)).run();
    }
    db.delete(skill).where(eq(skill.workspaceId, workspaceId)).run();
  });

  let created = 0;
  let skipped = 0;
  let contextLinks = 0;

  for (const ent of targetEntities) {
    const result = generateSkillForEntity(workspaceId, ent.id, allContexts);
    if (result) {
      created++;
      contextLinks += result.contextCount;
    } else {
      skipped++;
    }
  }

  return {
    total: targetEntities.length,
    created,
    skipped,
    contextLinks,
  };
}
