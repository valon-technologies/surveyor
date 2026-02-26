/**
 * Generate comprehensive mapping skills for all VDS entities with source→target pairings.
 *
 * Each skill bundles:
 *   - VDS entity context (primary) — target schema definition
 *   - ServiceMac table/domain contexts (primary) — source schema definition
 *   - Mortgage domain contexts (supplementary) — regulatory/business knowledge
 *   - Mapping methodology contexts (reference) — critical rules, patterns
 *   - Mapping Q&A contexts (reference) — prior decisions and open questions
 *
 * Usage: npx tsx scripts/generate-mapping-skills.ts
 */

import Database from "better-sqlite3";
import path from "path";
import crypto from "crypto";

const DB_PATH = path.resolve(process.cwd(), "surveyor.db");
const db = new Database(DB_PATH);
const WORKSPACE_ID = (
  db.prepare("SELECT id FROM workspace LIMIT 1").get() as { id: string }
).id;

// --- Build context lookup maps from DB ---
type CtxRow = { id: string; name: string };
const allContexts = db.prepare("SELECT id, name FROM context").all() as CtxRow[];

function findCtx(name: string): string | null {
  const row = allContexts.find((c) => c.name === name);
  return row?.id ?? null;
}

function findCtxLike(pattern: string): string | null {
  const row = allContexts.find((c) => c.name.includes(pattern));
  return row?.id ?? null;
}

// SM table CamelCase → context ID
const SM_TABLE_MAP: Record<string, string | null> = {
  LoanInfo: findCtx("ServiceMac > Tables > Loan Info"),
  StopsFlagsAndIndicators: findCtx("ServiceMac > Tables > Stops Flags Indicators"),
  EventDates: findCtx("ServiceMac > Tables > Event Dates"),
  Investor: findCtx("ServiceMac > Tables > Investor"),
  Arm: findCtx("ServiceMac > Tables > ARM"),
  Transaction: findCtx("ServiceMac > Tables > Transaction"),
  PaymentFactors: findCtx("ServiceMac > Tables > Payment Factors"),
  EscrowAnalysisHistory: findCtx("ServiceMac > Tables > Escrow Analysis History"),
  Tax: findCtx("ServiceMac > Tables > Tax"),
  Payee: findCtx("ServiceMac > Tables > Payee"),
  HazardInsurance: findCtx("ServiceMac > Tables > Hazard Insurance"),
  Claims: findCtx("ServiceMac > Tables > Claims"),
  BorrowerDemographics: findCtx("ServiceMac > Tables > Borrower Demographics"),
  TelephoneNumbers: findCtx("ServiceMac > Tables > Telephone Numbers"),
  Party: findCtx("ServiceMac > Tables > Party"),
  DefaultWorkstations: findCtx("ServiceMac > Tables > Default Workstations"),
  MilitaryRelief: findCtx("ServiceMac > Tables > Military Relief"),
  PropertyInspection: findCtx("ServiceMac > Tables > Property Inspection"),
  PropertyPreservation: findCtx("ServiceMac > Tables > Property Preservation"),
  CallLog: findCtx("ServiceMac > Tables > Call Log"),
  Notes: findCtx("ServiceMac > Tables > Notes"),
  Letter: findCtx("ServiceMac > Tables > Letter"),
  NonBorrower: findCtx("ServiceMac > Tables > Non Borrower"),
  DeceasedBorrower: findCtx("ServiceMac > Tables > Deceased Borrower"),
  LoanInvestorHistory: findCtx("ServiceMac > Tables > Loan Investor History"),
  PriorServicer: findCtx("ServiceMac > Tables > Prior Servicer"),
  Step: findCtx("ServiceMac > Tables > Step"),
  LossMitigation: null, // No separate table — mapped via domain + Step
  MbsPool: findCtx("ServiceMac > Tables > MBS Pool"),
  FloodInformationHistory: findCtx("ServiceMac > Tables > Flood Information History"),
  TaskTracking: findCtx("ServiceMac > Tables > Task Tracking"),
  Collateral: findCtx("ServiceMac > Tables > Collateral"),
};

// SM domain slug → context ID
const SM_DOMAIN_MAP: Record<string, string | null> = {
  foreclosure: findCtx("ServiceMac > Domains > Foreclosure"),
  bankruptcy: findCtx("ServiceMac > Domains > Bankruptcy"),
  "borrower-and-parties": findCtx("ServiceMac > Domains > Borrower And Parties"),
  "loss-mitigation": findCtx("ServiceMac > Domains > Loss Mitigation"),
};

// Manual overrides for entity names that don't match context names directly
const VDS_NAME_OVERRIDES: Record<string, string> = {
  property_insurance_period: "Property Insurance",
  property_insurance_company: "Mortgage Insurance Company",
  property_insurance_installment: "Mortgage Insurance Installment",
  arm_loan_info: "ARM",              // Category-level, not a leaf
  arm_rate_period: "ARM Rate Period",
  pre_foreclosure_state_process: "Pre Foreclosure State",
  non_borrower_loan_participant: "Non Borrower Participants",
  borrower_active_service_period: "Borrower Extensions",  // Closest match
  borrower_deceased: "Borrower Extensions",               // Tracked via extensions
  index_rate: "ARM Index Rate",
};

// VDS entity_name → context ID (built by scanning context names)
function entityNameToContextName(entityName: string): string {
  if (VDS_NAME_OVERRIDES[entityName]) return VDS_NAME_OVERRIDES[entityName];
  // Convert "loan_at_origination_info" → "Loan At Origination Info"
  return entityName
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function findVdsEntityCtx(entityName: string): string | null {
  const label = entityNameToContextName(entityName);
  // Search for exact match at leaf level: "VDS > ... > {label}"
  const row = allContexts.find(
    (c) => c.name.startsWith("VDS > ") && c.name.endsWith(` > ${label}`)
  );
  // Also check category level (e.g., "VDS > ARM" for arm_loan_info)
  if (!row) {
    const catRow = allContexts.find((c) => c.name === `VDS > ${label}`);
    return catRow?.id ?? null;
  }
  return row?.id ?? null;
}

function findVdsCategoryCtx(entityName: string): string | null {
  // Find the VDS entity context, then extract its category
  const label = entityNameToContextName(entityName);
  const entityCtx = allContexts.find(
    (c) => c.name.startsWith("VDS > ") && c.name.endsWith(` > ${label}`)
  );
  if (!entityCtx) return null;
  // "VDS > Core Loan > Loan" → category is "VDS > Core Loan"
  const parts = entityCtx.name.split(" > ");
  if (parts.length < 3) return null;
  const categoryName = `${parts[0]} > ${parts[1]}`;
  return findCtx(categoryName);
}

// Mortgage keyword → context IDs
const MORTGAGE_KEYWORD_MAP: Record<string, string[]> = {
  escrow: [
    findCtx("Mortgage Servicing > Federal > CFPB > Administering Escrow Accounts"),
    findCtx("Mortgage Servicing > State > Managing State Escrow Requirements"),
    findCtx("Mortgage Servicing > GSE > Fannie Mae > Managing Fannie Mae Escrow"),
    findCtx("Mortgage Servicing > GSE > Freddie Mac > Managing Freddie Mac Escrow"),
  ].filter(Boolean) as string[],
  respa: [findCtx("Mortgage Servicing > Federal > CFPB > Administering Escrow Accounts")].filter(Boolean) as string[],
  cfpb: [
    findCtx("Mortgage Servicing > Federal > CFPB > Processing Loss Mitigation Applications"),
    findCtx("Mortgage Servicing > Federal > CFPB > Administering Escrow Accounts"),
  ].filter(Boolean) as string[],
  mers: [findCtx("Mortgage Servicing > Industry > Managing MERS Loans")].filter(Boolean) as string[],
  gse: [
    findCtx("Mortgage Servicing > GSE > Fannie Mae > Reporting To Fannie Mae"),
    findCtx("Mortgage Servicing > GSE > Freddie Mac > Reporting To Freddie Mac"),
  ].filter(Boolean) as string[],
  fannie: [findCtx("Mortgage Servicing > GSE > Fannie Mae > Reporting To Fannie Mae")].filter(Boolean) as string[],
  freddie: [findCtx("Mortgage Servicing > GSE > Freddie Mac > Reporting To Freddie Mac")].filter(Boolean) as string[],
  ginnie: [findCtx("Mortgage Servicing > GSE > Ginnie Mae > Servicing Ginnie Mae Loans")].filter(Boolean) as string[],
  fha: [findCtx("Mortgage Servicing > Government Insurers > FHA > Servicing FHA Loans")].filter(Boolean) as string[],
  va: [findCtx("Mortgage Servicing > Government Insurers > VA > Servicing VA Loans")].filter(Boolean) as string[],
  usda: [findCtx("Mortgage Servicing > Government Insurers > USDA > Servicing USDA Loans")].filter(Boolean) as string[],
  pmi: [findCtx("Mortgage Servicing > Federal > HPA > Managing Private Mortgage Insurance")].filter(Boolean) as string[],
  hpa: [findCtx("Mortgage Servicing > Federal > HPA > Managing Private Mortgage Insurance")].filter(Boolean) as string[],
  mi_certificate: [findCtx("Mortgage Servicing > Private Insurers > Managing MI Certificates")].filter(Boolean) as string[],
  pii: [findCtx("Mortgage Servicing > Federal > GLBA > Providing Privacy Notices")].filter(Boolean) as string[],
  hmda: [findCtx("Mortgage Servicing > Federal > FCRA > Furnishing Credit Information")].filter(Boolean) as string[],
  ssn: [findCtx("Mortgage Servicing > Federal > GLBA > Providing Privacy Notices")].filter(Boolean) as string[],
  foreclosure: [
    findCtx("Mortgage Servicing > State > Navigating State Foreclosure Requirements"),
    findCtx("Mortgage Servicing > GSE > Fannie Mae > Managing Fannie Mae Foreclosure"),
    findCtx("Mortgage Servicing > GSE > Freddie Mac > Managing Freddie Mac Foreclosure"),
  ].filter(Boolean) as string[],
  fc_status: [findCtx("Mortgage Servicing > State > Navigating State Foreclosure Requirements")].filter(Boolean) as string[],
  judicial: [findCtx("Mortgage Servicing > State > Navigating State Foreclosure Requirements")].filter(Boolean) as string[],
  bankruptcy: [findCtx("Mortgage Servicing > Industry > Managing Bankruptcy Proceedings")].filter(Boolean) as string[],
  chapter_7: [findCtx("Mortgage Servicing > Industry > Managing Bankruptcy Proceedings")].filter(Boolean) as string[],
  chapter_13: [findCtx("Mortgage Servicing > Industry > Managing Bankruptcy Proceedings")].filter(Boolean) as string[],
  scra: [findCtx("Mortgage Servicing > Federal > SCRA > Applying SCRA Protections")].filter(Boolean) as string[],
  military: [findCtx("Mortgage Servicing > Federal > SCRA > Applying SCRA Protections")].filter(Boolean) as string[],
  tcpa: [findCtx("Mortgage Servicing > Federal > TCPA > Complying With TCPA")].filter(Boolean) as string[],
  loss_mit: [findCtx("Mortgage Servicing > Federal > CFPB > Processing Loss Mitigation Applications")].filter(Boolean) as string[],
  forbearance: [findCtx("Mortgage Servicing > Federal > CFPB > Processing Loss Mitigation Applications")].filter(Boolean) as string[],
  modification: [findCtx("Mortgage Servicing > Federal > CFPB > Processing Loss Mitigation Applications")].filter(Boolean) as string[],
  force_placed: [findCtx("Mortgage Servicing > Federal > CFPB > Managing Force Placed Insurance")].filter(Boolean) as string[],
  credit_score: [findCtx("Mortgage Servicing > Federal > FCRA > Furnishing Credit Information")].filter(Boolean) as string[],
};

// SM table → enum context mapping
// Maps ACDC table names to their Lookups tab extract type for enum resolution.
// Some tables share enum contexts (e.g., BorrowerDemographics uses FairLending enums).
const SM_ENUM_MAP: Record<string, string | null> = {
  LoanInfo: findCtx("ServiceMac > Enums > LOANINFO ENUMS"),
  StopsFlagsAndIndicators: findCtx("ServiceMac > Enums > STOPSFLAGSANDINDICATORS ENUMS"),
  Investor: findCtx("ServiceMac > Enums > INVESTOR ENUMS"),
  Arm: findCtx("ServiceMac > Enums > ARM ENUMS"),
  Transaction: findCtx("ServiceMac > Enums > TRANSACTION ENUMS"),
  HazardInsurance: findCtx("ServiceMac > Enums > HAZARDINSURANCE ENUMS"),
  Tax: findCtx("ServiceMac > Enums > TAX ENUMS"),
  DefaultWorkstations: findCtx("ServiceMac > Enums > DEFAULTWORKSTATIONS ENUMS"),
  Heloc: findCtx("ServiceMac > Enums > HELOC ENUMS"),
  HelocSegments: findCtx("ServiceMac > Enums > HELOCSEGMENTS ENUMS"),
  Letter: findCtx("ServiceMac > Enums > LETTER ENUMS"),
  Step: findCtx("ServiceMac > Enums > STEP ENUMS"),
  LossMitigation: findCtx("ServiceMac > Enums > LOSSMITIGATION ENUMS"),
  // BorrowerDemographics enums are under FairLending extract type in Lookups tab
  BorrowerDemographics: findCtx("ServiceMac > Enums > FAIRLENDING ENUMS"),
  FairLending: findCtx("ServiceMac > Enums > FAIRLENDING ENUMS"),
};

// NOTE: Domain overviews (OVERVIEW_CTX) and methodology contexts (METHODOLOGY_CTX)
// are no longer linked per-skill. They are injected into the system message via
// system-context.ts. MAPPING DECISIONS is now RAG-only.

// Q&A context lookup
function findQaContexts(entityName: string): string[] {
  const label = entityName.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return allContexts
    .filter((c) => c.name.startsWith(`Mapping Q&A > ${label}`))
    .map((c) => c.id);
}

// --- Entity pairings (from research) ---
interface EntityPairing {
  sm_tables: string[];
  sm_domains: string[];
  mortgage_keywords: string[];
  tier: string;
}

const ENTITY_PAIRINGS: Record<string, EntityPairing> = {
  loan: { sm_tables: ["LoanInfo", "StopsFlagsAndIndicators", "EventDates", "Investor", "Arm"], sm_domains: [], mortgage_keywords: ["mers", "gse", "fha", "va", "usda"], tier: "P0" },
  loan_accounting_balance: { sm_tables: ["LoanInfo"], sm_domains: [], mortgage_keywords: [], tier: "P0" },
  loan_at_origination_info: { sm_tables: ["LoanInfo"], sm_domains: [], mortgage_keywords: [], tier: "P0" },
  loan_at_data_transfer_info: { sm_tables: ["LoanInfo", "PriorServicer"], sm_domains: [], mortgage_keywords: [], tier: "P0" },
  loan_fee: { sm_tables: ["Transaction"], sm_domains: [], mortgage_keywords: [], tier: "P0" },
  loan_expense: { sm_tables: ["Transaction"], sm_domains: [], mortgage_keywords: [], tier: "P0" },
  loan_comment: { sm_tables: ["Notes"], sm_domains: [], mortgage_keywords: [], tier: "P0" },
  loan_to_property: { sm_tables: ["LoanInfo"], sm_domains: [], mortgage_keywords: [], tier: "P0" },
  loan_to_portfolio: { sm_tables: ["LoanInvestorHistory"], sm_domains: [], mortgage_keywords: [], tier: "P0" },
  borrower: { sm_tables: ["LoanInfo", "BorrowerDemographics", "TelephoneNumbers"], sm_domains: ["borrower-and-parties"], mortgage_keywords: ["pii", "hmda", "scra"], tier: "P0" },
  borrower_to_loan: { sm_tables: ["LoanInfo"], sm_domains: ["borrower-and-parties"], mortgage_keywords: [], tier: "P0" },
  borrower_phone_number: { sm_tables: ["TelephoneNumbers"], sm_domains: ["borrower-and-parties"], mortgage_keywords: ["tcpa"], tier: "P0" },
  borrower_credit_score: { sm_tables: ["BorrowerDemographics"], sm_domains: ["borrower-and-parties"], mortgage_keywords: ["credit_score"], tier: "P0" },
  address: { sm_tables: ["LoanInfo"], sm_domains: ["borrower-and-parties"], mortgage_keywords: [], tier: "P0" },
  property: { sm_tables: ["LoanInfo"], sm_domains: [], mortgage_keywords: [], tier: "P0" },
  flood_info: { sm_tables: ["FloodInformationHistory"], sm_domains: [], mortgage_keywords: [], tier: "P0" },
  loan_payment: { sm_tables: ["Transaction"], sm_domains: [], mortgage_keywords: [], tier: "P0" },
  loan_payment_amortization_schedule: { sm_tables: ["LoanInfo"], sm_domains: [], mortgage_keywords: [], tier: "P0" },
  escrow_analysis: { sm_tables: ["EscrowAnalysisHistory", "PaymentFactors"], sm_domains: [], mortgage_keywords: ["escrow", "respa", "cfpb"], tier: "P0" },
  escrow_disbursement: { sm_tables: ["Transaction"], sm_domains: [], mortgage_keywords: ["escrow"], tier: "P0" },
  escrow_schedule: { sm_tables: ["PaymentFactors"], sm_domains: [], mortgage_keywords: ["escrow"], tier: "P0" },
  loan_tax_info: { sm_tables: ["Tax"], sm_domains: [], mortgage_keywords: [], tier: "P0" },
  loan_tax_parcel: { sm_tables: ["Tax"], sm_domains: [], mortgage_keywords: [], tier: "P0" },
  loan_tax_installment: { sm_tables: ["Tax", "Transaction"], sm_domains: [], mortgage_keywords: [], tier: "P0" },
  tax_authority: { sm_tables: ["Payee"], sm_domains: [], mortgage_keywords: [], tier: "P0" },
  property_insurance_period: { sm_tables: ["HazardInsurance"], sm_domains: [], mortgage_keywords: ["force_placed"], tier: "P0" },
  property_insurance_company: { sm_tables: ["Payee"], sm_domains: [], mortgage_keywords: [], tier: "P0" },
  mortgage_insurance: { sm_tables: ["LoanInfo", "Claims"], sm_domains: [], mortgage_keywords: ["pmi", "hpa", "fha"], tier: "P0" },
  mortgage_insurance_company: { sm_tables: ["Payee"], sm_domains: [], mortgage_keywords: [], tier: "P0" },
  portfolio: { sm_tables: ["Investor"], sm_domains: [], mortgage_keywords: ["gse"], tier: "P0" },
  arm_loan_info: { sm_tables: ["Arm"], sm_domains: [], mortgage_keywords: [], tier: "P0" },
  arm_rate_period: { sm_tables: ["Arm"], sm_domains: [], mortgage_keywords: [], tier: "P0" },
  notification: { sm_tables: ["Letter"], sm_domains: [], mortgage_keywords: [], tier: "P0" },
  // P1 entities
  loss_mitigation_application: { sm_tables: ["Step"], sm_domains: ["loss-mitigation"], mortgage_keywords: ["loss_mit", "cfpb"], tier: "P1" },
  loss_mitigation_forbearance: { sm_tables: ["Step"], sm_domains: ["loss-mitigation"], mortgage_keywords: ["forbearance"], tier: "P1" },
  loss_mitigation_loan_modification: { sm_tables: ["Step"], sm_domains: ["loss-mitigation"], mortgage_keywords: ["modification"], tier: "P1" },
  loss_mitigation_payment_deferral: { sm_tables: ["Step"], sm_domains: ["loss-mitigation"], mortgage_keywords: ["loss_mit"], tier: "P1" },
  loss_mitigation_repayment_plan: { sm_tables: ["Step"], sm_domains: ["loss-mitigation"], mortgage_keywords: ["loss_mit"], tier: "P1" },
  loss_mitigation_partial_claim: { sm_tables: ["Step"], sm_domains: ["loss-mitigation"], mortgage_keywords: ["fha", "loss_mit"], tier: "P1" },
  loss_mitigation_plan: { sm_tables: ["Step"], sm_domains: ["loss-mitigation"], mortgage_keywords: ["loss_mit"], tier: "P1" },
  loss_mitigation_hardship: { sm_tables: ["Step"], sm_domains: ["loss-mitigation"], mortgage_keywords: ["loss_mit"], tier: "P1" },
  loss_mitigation_denial: { sm_tables: ["Step"], sm_domains: ["loss-mitigation"], mortgage_keywords: ["loss_mit"], tier: "P1" },
  loss_mitigation_appeal: { sm_tables: ["Step"], sm_domains: ["loss-mitigation"], mortgage_keywords: ["loss_mit"], tier: "P1" },
  foreclosure: { sm_tables: ["LoanInfo", "Step", "DefaultWorkstations", "Party"], sm_domains: ["foreclosure"], mortgage_keywords: ["foreclosure", "judicial"], tier: "P1" },
  foreclosure_sale: { sm_tables: ["EventDates", "Step", "LoanInfo"], sm_domains: ["foreclosure"], mortgage_keywords: ["foreclosure"], tier: "P1" },
  foreclosure_bid: { sm_tables: ["Step", "LoanInfo"], sm_domains: ["foreclosure"], mortgage_keywords: ["foreclosure"], tier: "P1" },
  foreclosure_hold: { sm_tables: ["Step"], sm_domains: ["foreclosure"], mortgage_keywords: ["foreclosure", "bankruptcy"], tier: "P1" },
  foreclosure_reinstatement: { sm_tables: ["Transaction"], sm_domains: ["foreclosure"], mortgage_keywords: ["foreclosure"], tier: "P1" },
  pre_foreclosure_state_process: { sm_tables: ["Step"], sm_domains: ["foreclosure"], mortgage_keywords: ["foreclosure"], tier: "P1" },
  bankruptcy_case: { sm_tables: ["LoanInfo", "Step", "DefaultWorkstations"], sm_domains: ["bankruptcy"], mortgage_keywords: ["bankruptcy"], tier: "P1" },
  borrower_active_service_period: { sm_tables: ["MilitaryRelief"], sm_domains: [], mortgage_keywords: ["scra", "military"], tier: "P1" },
  property_inspection: { sm_tables: ["PropertyInspection"], sm_domains: [], mortgage_keywords: [], tier: "P1" },
  non_borrower_loan_participant: { sm_tables: ["NonBorrower"], sm_domains: ["borrower-and-parties"], mortgage_keywords: [], tier: "P1" },
  borrower_deceased: { sm_tables: ["DeceasedBorrower"], sm_domains: ["borrower-and-parties"], mortgage_keywords: [], tier: "P1" },
};

// --- Generate skills ---
// First, clear existing skills
db.prepare("DELETE FROM skill_context").run();
db.prepare("DELETE FROM skill").run();
console.log("Cleared existing skills.\n");

const insertSkill = db.prepare(`
  INSERT INTO skill (id, workspace_id, name, description, instructions, applicability, tags, is_active, sort_order)
  VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
`);

const insertSkillContext = db.prepare(`
  INSERT INTO skill_context (id, skill_id, context_id, role, sort_order, notes)
  VALUES (?, ?, ?, ?, ?, ?)
`);

let skillCount = 0;
let linkCount = 0;
let skippedEntities: string[] = [];

const insertAll = db.transaction(() => {
  for (const [entityName, pairing] of Object.entries(ENTITY_PAIRINGS)) {
    const vdsCtxId = findVdsEntityCtx(entityName);
    if (!vdsCtxId) {
      skippedEntities.push(entityName);
      continue;
    }

    const label = entityNameToContextName(entityName);
    const skillId = crypto.randomUUID();

    // Build description
    const tierLabel = pairing.tier === "P0" ? "Go-Live Critical" : "Post-Launch";
    const smTableNames = pairing.sm_tables.filter((t) => SM_TABLE_MAP[t]).map((t) => t);
    const description = `Maps ServiceMac data to VDS ${entityName} entity (${tierLabel}). Source tables: ${smTableNames.join(", ") || "TBD"}. Use when mapping ${entityName.replace(/_/g, " ")} fields.`;

    // Build instructions
    const sourceTableList = smTableNames.length > 0
      ? `### Source Tables\n${smTableNames.map((t) => `- **${t}**`).join("\n")}`
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

    // Build applicability
    const applicability = {
      entityPatterns: [entityName, entityName.replace(/_/g, " ")],
    };

    const tags = ["mapping", pairing.tier.toLowerCase(), entityName.replace(/_/g, "-")];

    insertSkill.run(
      skillId, WORKSPACE_ID, `Mapping: ${label}`, description,
      instructions, JSON.stringify(applicability), JSON.stringify(tags),
      skillCount
    );

    let ctxOrder = 0;

    // --- Link contexts ---

    // 1. VDS entity (primary)
    insertSkillContext.run(crypto.randomUUID(), skillId, vdsCtxId, "primary", ctxOrder++,
      `VDS ${entityName} entity definition — fields, enums, mapping patterns`);
    linkCount++;

    // 2. SM tables (primary)
    for (const table of pairing.sm_tables) {
      const ctxId = SM_TABLE_MAP[table];
      if (ctxId) {
        insertSkillContext.run(crypto.randomUUID(), skillId, ctxId, "primary", ctxOrder++,
          `ServiceMac ${table} — source data schema`);
        linkCount++;
      }
    }

    // 2b. SM enum contexts (reference) — authoritative code→value lookups from Lookups tab
    const seenEnumCtxIds = new Set<string>();
    for (const table of pairing.sm_tables) {
      const enumCtxId = SM_ENUM_MAP[table];
      if (enumCtxId && !seenEnumCtxIds.has(enumCtxId)) {
        seenEnumCtxIds.add(enumCtxId);
        insertSkillContext.run(crypto.randomUUID(), skillId, enumCtxId, "reference", ctxOrder++,
          `ServiceMac ${table} enum values — authoritative code definitions from Lookups tab`);
        linkCount++;
      }
    }

    // 3. SM domains (reference)
    for (const domain of pairing.sm_domains) {
      const ctxId = SM_DOMAIN_MAP[domain];
      if (ctxId) {
        insertSkillContext.run(crypto.randomUUID(), skillId, ctxId, "reference", ctxOrder++,
          `ServiceMac ${domain} domain — cross-table mapping guide`);
        linkCount++;
      }
    }

    // 4. VDS category overview (reference)
    const categoryCtxId = findVdsCategoryCtx(entityName);
    if (categoryCtxId) {
      insertSkillContext.run(crypto.randomUUID(), skillId, categoryCtxId, "reference", ctxOrder++,
        "VDS category overview — related entities and navigation");
      linkCount++;
    }

    // NOTE: Sections 5-8 (domain overviews, critical rules, mapping decisions,
    // table relationships) are now injected into the system message via
    // system-context.ts instead of per-skill duplication. MAPPING DECISIONS
    // is now RAG-only (retrieved via get_reference_docs).

    // 5. Mortgage domain contexts (supplementary) — based on keywords
    const mortgageCtxIds = new Set<string>();
    for (const keyword of pairing.mortgage_keywords) {
      const ids = MORTGAGE_KEYWORD_MAP[keyword] ?? [];
      for (const id of ids) mortgageCtxIds.add(id);
    }
    for (const ctxId of mortgageCtxIds) {
      const ctxName = allContexts.find((c) => c.id === ctxId)?.name ?? "";
      insertSkillContext.run(crypto.randomUUID(), skillId, ctxId, "supplementary", ctxOrder++,
        `Regulatory context: ${ctxName}`);
      linkCount++;
    }

    // 6. Q&A contexts (reference)
    const qaIds = findQaContexts(entityName);
    for (const qaId of qaIds) {
      const qaName = allContexts.find((c) => c.id === qaId)?.name ?? "";
      insertSkillContext.run(crypto.randomUUID(), skillId, qaId, "reference", ctxOrder++,
        `Prior Q&A: ${qaName}`);
      linkCount++;
    }

    // 7. Related entity SOT examples (supplementary) — confirmed M1 ground truth mappings
    // from sibling entities in the same domain. Provides few-shot mapping patterns.
    // Own SOT is excluded here (and also guarded by assembler's excludeEntityName).
    const relatedEntityNames = Object.entries(ENTITY_PAIRINGS)
      .filter(([name, p]) =>
        name !== entityName &&
        p.sm_domains.some((d) => pairing.sm_domains.includes(d))
      )
      .map(([name]) => name);

    // Fallback: name-prefix match for entities with no shared domain
    if (relatedEntityNames.length === 0) {
      const prefix = entityName.split("_")[0];
      for (const [name] of Object.entries(ENTITY_PAIRINGS)) {
        if (name !== entityName && name.startsWith(prefix + "_")) {
          relatedEntityNames.push(name);
        }
      }
    }

    for (const relatedName of relatedEntityNames) {
      const sotCtxId = findCtx(`SOT > ${relatedName} (M1)`);
      if (sotCtxId) {
        insertSkillContext.run(crypto.randomUUID(), skillId, sotCtxId, "supplementary", ctxOrder++,
          `Confirmed M1 mappings for ${relatedName} — use EXACT rows as mapping patterns`);
        linkCount++;
      }
    }

    skillCount++;
    console.log(`  ${label} — ${ctxOrder} contexts linked`);
  }
});

insertAll();

console.log(`\nGenerated ${skillCount} skills with ${linkCount} context links.`);
if (skippedEntities.length > 0) {
  console.log(`\nSkipped ${skippedEntities.length} entities (no matching VDS context):`);
  for (const e of skippedEntities) console.log(`  - ${e}`);
}

db.close();
