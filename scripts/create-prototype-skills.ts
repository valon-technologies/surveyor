/**
 * Create prototype skills for 4 VDS entities: Loan, Escrow Analysis, Borrower, Foreclosure.
 *
 * Each skill bundles:
 *   - Instructions (L2): how to approach mapping this entity
 *   - Primary context: the VDS entity doc
 *   - Reference contexts: category overview + related entities
 *   - Supplementary contexts: relevant mortgage domain knowledge
 *
 * Usage: npx tsx scripts/create-prototype-skills.ts
 */

import Database from "better-sqlite3";
import path from "path";
import crypto from "crypto";

const DB_PATH = path.resolve(process.cwd(), "surveyor.db");
const WORKSPACE_ID = "fbc37e23-39b4-4cdc-b162-f1f7d9772ab0";
const db = new Database(DB_PATH);

function makeId(): string {
  return crypto.randomUUID();
}

interface SkillDef {
  name: string;
  description: string;
  instructions: string;
  applicability: {
    entityPatterns?: string[];
    fieldPatterns?: string[];
    dataTypes?: string[];
  };
  tags: string[];
  contexts: {
    contextId: string;
    role: "primary" | "reference" | "supplementary";
    notes?: string;
  }[];
}

// --- Context IDs (queried from DB) ---
const CTX = {
  // VDS entity docs (primary)
  loan: "cc67701e-45bd-6020-8419-20fd4ee00fd6",
  escrowAnalysis: "8f06c04d-ac45-e935-d350-75b41d56a1cf",
  borrower: "56e33a02-c1f7-6b9b-21b2-d48d9ea8c933",
  foreclosure: "ad33cc76-6cdd-e121-f4e6-e68a43b79b5f",

  // VDS category overviews (reference)
  coreLoan: "34d85b53-8c5d-72a0-a8c5-fcd8497114e1",
  escrow: "59dfb26b-d2fe-75b0-868a-b1d0b2dfeb42",
  borrowerParty: "d033dcb1-f8c4-e161-0665-3330c7042da4",
  foreclosureCategory: "269d29c1-90af-62c1-4352-12eca34efbfe",

  // Mortgage domain (supplementary)
  cfpbEscrow: "a6d816c3-39ae-9489-898b-2851545ee232",
  stateEscrow: "f3fe56b6-e2a2-21a9-aca9-a31b4262d72d",
  fannieEscrow: "937b23bd-61e8-9b7b-d20a-05d703b81ded",
  freddieEscrow: "1ae8524a-4dee-6805-4b4e-e423f46a2786",
  fcra: "88e355a5-b4ac-a931-6cb6-b70d10ce1965",
  glba: "bd0588dc-998b-9729-26ae-fb5eed4b27b5",
  scra: "f0d6d870-16eb-3d5e-73cf-d68de01015c8",
  tcpa: "608f3c9e-f932-78ca-3266-f06f33eac776",
  stateForeclosure: "c540a02d-7021-cf78-0670-8d00f18abbb2",
  bankruptcy: "116139b2-5a5d-c13b-1c29-2e2d94f6853a",
  mers: "caea7ed5-8ef3-ec3c-9c20-6178bd8ba51b",
  fannieForeclosure: "cca08d9c-9197-bc9a-aa27-b07ce37bb077",
  freddieForeclosure: "d54a8583-a86a-408d-bbe1-be4e325836c0",
  fhaForeclosure: "f62ff4e0-4029-cd1c-463b-345f4ca702b7",
  vaForeclosure: "779f803f-6457-787c-c6c8-c0f48913f99a",
  fannieReporting: "f250415b-4424-a7f1-60af-2c53e2b830d0",
  freddieReporting: "cf90ede6-5355-0906-fa46-dfb57c9c48a9",
};

// --- Skill Definitions ---

const skills: SkillDef[] = [
  {
    name: "Mapping: Loan Entity",
    description:
      "Maps source data to the VDS loan entity — the central table with 80+ fields covering identifiers, terms, dates, rates, booleans, investor data, and government insurance. Use when mapping loan-level data including loan numbers, interest rates, balances, MERS registration, or loan status.",
    instructions: `## Mapping Approach

This is the most complex VDS entity with 80+ fields. You MUST map ALL fields, not just common ones.

### Source Tables Required
\`\`\`sql
FROM LoanInfo l
LEFT JOIN StopsFlagsAndIndicators fi ON l.LoanNumber = fi.LoanNumber  -- 15+ boolean fields
LEFT JOIN EventDates ed ON l.LoanNumber = ed.LoanNumber               -- 10+ date fields
LEFT JOIN Investor inv ON l.InvestorId = inv.InvestorId               -- investor/servicer numbers, MERS org
LEFT JOIN Arm a ON l.LoanNumber = a.LoanNumber                        -- ARM fields if applicable
\`\`\`

### Field Categories (map in order)
1. **Identifiers** (~15): loan_number, mers_id_number, investor_loan_number, fannie/freddie/ginnie numbers
2. **Terms** (~10): note_rate, original_loan_amount, amortization_term, remaining_term
3. **Dates** (~12): effective_transfer_date, maturity_date, next_payment_due_date, inactive_date
4. **Rates** (~6): note_rate, guaranty_fee_rate, margin_rate, hamp_step_rate
5. **Booleans** (~18): is_assumable, is_balloon, is_charged_off, is_option_arm — mostly from StopsFlagsAndIndicators
6. **Investor** (~8): fannie_holding_type, note_holder_current, vesting_name
7. **Enums** (~10): status, mortgage_classification, product_type, other_agency_type

### Key Rules
- Status lifecycle: INITIATED → IN_PROGRESS → COMPLETED | CHARGED_OFF | OFFBOARDED
- ACDC dates are already YYYY-MM-DD — no conversion needed
- Skip system-generated fields (sid, created_at, updated_at, deleted_at)
- Verify every field name and data type against VDS schema CSV`,
    applicability: {
      entityPatterns: ["loan"],
      fieldPatterns: [
        "loan_number",
        "note_rate",
        "mers_id",
        "investor_loan",
        "original_loan_amount",
        "maturity_date",
        "loan_status",
      ],
    },
    tags: ["vds", "core-loan", "loan", "mapping"],
    contexts: [
      { contextId: CTX.loan, role: "primary", notes: "VDS loan entity — 80+ fields, enums, mapping patterns" },
      { contextId: CTX.coreLoan, role: "reference", notes: "Core Loan category overview — related entities" },
      { contextId: CTX.mers, role: "supplementary", notes: "MERS registration requirements for MERS fields" },
      { contextId: CTX.fannieReporting, role: "supplementary", notes: "Fannie Mae investor reporting for GSE fields" },
      { contextId: CTX.freddieReporting, role: "supplementary", notes: "Freddie Mac investor reporting for GSE fields" },
    ],
  },

  {
    name: "Mapping: Escrow Analysis",
    description:
      "Maps source data to the VDS escrow_analysis entity — records annual/on-demand escrow analysis results using CFPB RESPA aggregate method. Use when mapping escrow analysis data, shortage/overage calculations, payment impact determinations, or cushion amounts.",
    instructions: `## Mapping Approach

Escrow analysis is heavily regulated by RESPA (12 CFR § 1024.17). The mapping must capture both the numerical results and the action determination.

### Key Mapping Decisions
1. **analysis_date_as_of**: The date of the escrow analysis — map from source analysis date
2. **impact_to_payment** (enum): The action taken — NO_FURTHER_ACTION, OVERAGE_REFUND_BORROWER, SHORTAGE_MAKE_SINGLE_PAYMENT, SHORTAGE_INCREASE_MONTHLY_PAYMENT
3. **amount_new_monthly_payment**: The new escrow portion after analysis
4. **total_shortage_or_overage_amount**: Positive = overage, negative = shortage

### State-Specific Cushion Rules
Most states allow a 2-month cushion. Exceptions:
- Nevada, North Dakota: 0-month cushion
- Montana, Vermont: 1-month cushion
- Check the State Escrow Requirements context for the applicable state

### Source Pattern
Escrow analyses typically come from a history table with one row per analysis event. Map the most recent analysis as the current state, but preserve the full history.

### Related Entities
- Parent: loan (via loan_sid)
- Siblings: escrow_schedule, escrow_disbursement
- The escrow_schedule holds the line items; escrow_analysis holds the aggregate results`,
    applicability: {
      entityPatterns: ["escrow_analysis", "escrow analysis"],
      fieldPatterns: [
        "shortage",
        "overage",
        "cushion",
        "escrow_analysis",
        "impact_to_payment",
      ],
    },
    tags: ["vds", "escrow", "escrow-analysis", "mapping", "respa"],
    contexts: [
      { contextId: CTX.escrowAnalysis, role: "primary", notes: "VDS escrow_analysis entity — fields, enums, patterns" },
      { contextId: CTX.escrow, role: "reference", notes: "Escrow category overview — related entities" },
      { contextId: CTX.cfpbEscrow, role: "supplementary", notes: "CFPB RESPA escrow rules — aggregate analysis method, cushion limits" },
      { contextId: CTX.stateEscrow, role: "supplementary", notes: "State-specific escrow requirements — cushion variations" },
      { contextId: CTX.fannieEscrow, role: "supplementary", notes: "Fannie Mae escrow requirements" },
      { contextId: CTX.freddieEscrow, role: "supplementary", notes: "Freddie Mac escrow requirements" },
    ],
  },

  {
    name: "Mapping: Borrower",
    description:
      "Maps source data to the VDS borrower entity — the central customer record with 25+ fields for identity, contact info, demographics, and SCRA protection. Use when mapping borrower PII, contact information, demographic data, or military service status.",
    instructions: `## Mapping Approach

The borrower entity contains sensitive PII/SPI. Pay special attention to data handling and regulatory requirements.

### Key Mapping Decisions
1. **De-duplication**: One borrower can have many loans (via borrower_to_loan). Match on SSN first, then name+secondary identifiers
2. **PII fields**: social_security_number, date_of_birth — ensure proper masking/encryption in transit
3. **Address**: Mailing address stored via mailing_address_sid FK to address entity — map addresses separately
4. **Demographics**: Race, ethnicity, gender are HMDA-reportable — map if available but check enum values carefully

### Pattern: One Borrower → Many Loans
The borrower entity is de-duplicated across loans. The borrower_to_loan junction entity tracks the relationship and role (primary borrower, co-borrower, etc.).

### Related Entity Mapping Order
1. Map borrower first (identity, contact)
2. Map address separately (borrower references via FK)
3. Map borrower_to_loan junction (links borrower to loan with role)
4. Map borrower_phone_number (one-to-many)
5. Map borrower_credit_score (one-to-many, time-series)

### Regulatory Context
- FCRA: Credit reporting obligations for borrower data
- GLBA: Privacy notice requirements
- SCRA: Military service protection — check is_scra_protected flag
- TCPA: Phone contact consent requirements`,
    applicability: {
      entityPatterns: ["borrower"],
      fieldPatterns: [
        "first_name",
        "last_name",
        "ssn",
        "social_security",
        "borrower",
        "date_of_birth",
        "email_address",
      ],
    },
    tags: ["vds", "borrower-party", "borrower", "mapping", "pii"],
    contexts: [
      { contextId: CTX.borrower, role: "primary", notes: "VDS borrower entity — 25+ fields, de-dup logic, enums" },
      { contextId: CTX.borrowerParty, role: "reference", notes: "Borrower Party category — related entities (phone, credit, address)" },
      { contextId: CTX.fcra, role: "supplementary", notes: "FCRA credit reporting obligations for borrower data" },
      { contextId: CTX.glba, role: "supplementary", notes: "GLBA privacy requirements for borrower PII" },
      { contextId: CTX.scra, role: "supplementary", notes: "SCRA military protections — is_scra_protected field" },
      { contextId: CTX.tcpa, role: "supplementary", notes: "TCPA phone contact consent — borrower phone mapping" },
    ],
  },

  {
    name: "Mapping: Foreclosure",
    description:
      "Maps source data to the VDS foreclosure entity — the primary foreclosure case tracking record with 80+ fields covering status, judicial standing, timeline dates, attorney/auction info, and holds. Use when mapping foreclosure cases, sale dates, referral data, judgment amounts, or redemption periods.",
    instructions: `## Mapping Approach

Foreclosure is one of the most complex entities with 80+ fields, a 23-value status enum, and deep regulatory requirements that vary by state and investor.

### Key Mapping Decisions
1. **referral_date**: MUST be set — this is the anchor for point-in-time active queries
2. **status** (23 values): Map carefully. Active (17), Pending (3), Terminal (4)
3. **judicial_standing**: JUDICIAL or NON_JUDICIAL — determines which timeline fields apply
4. **Timeline dates** (~23 fields): notification, legal action, judgment, mediation, sale, redemption, reinstatement, title, deed, deficiency

### Source Pattern: Event Log → Status
ServiceMac foreclosure data often uses Step codes (event log pattern). You need to:
1. Identify the current status from the most recent step
2. Extract dates from step history for the 23 timeline fields
3. Map monetary fields (deficiency, fees, sale amounts) from related tables

### Holds Integration
Creating a foreclosure_hold blocks the workflow. Hold reasons: BANKRUPTCY, LOSS_MITIGATION, LITIGATION, FEMA_DISASTER. Map from source stop/flag indicators.

### Regulatory Layering
Multiple regulatory frameworks apply simultaneously to any foreclosure:
- Federal (CFPB loss mitigation review before foreclosure sale)
- State (judicial vs non-judicial process, redemption periods, mediation requirements)
- Investor (GSE timeline requirements, FHA/VA special processes)
- The most restrictive rule wins

### Related Entities
- Parent: loan (via loan_sid)
- Children: foreclosure_sale, foreclosure_hold, foreclosure_bid, foreclosure_payoff, foreclosure_reinstatement
- Cross-reference: loss_mitigation_application (holds)`,
    applicability: {
      entityPatterns: ["foreclosure"],
      fieldPatterns: [
        "referral_date",
        "judicial",
        "foreclosure_status",
        "sale_date",
        "deficiency",
        "redemption",
      ],
    },
    tags: ["vds", "foreclosure", "mapping", "regulatory"],
    contexts: [
      { contextId: CTX.foreclosure, role: "primary", notes: "VDS foreclosure entity — 80+ fields, 23-value status enum, timeline" },
      { contextId: CTX.foreclosureCategory, role: "reference", notes: "Foreclosure category — related entities (sale, hold, bid, etc.)" },
      { contextId: CTX.stateForeclosure, role: "supplementary", notes: "State foreclosure requirements — judicial vs non-judicial, timelines" },
      { contextId: CTX.fannieForeclosure, role: "supplementary", notes: "Fannie Mae foreclosure process and timeline requirements" },
      { contextId: CTX.freddieForeclosure, role: "supplementary", notes: "Freddie Mac foreclosure process and requirements" },
      { contextId: CTX.fhaForeclosure, role: "supplementary", notes: "FHA foreclosure — CWCOT, special processes" },
      { contextId: CTX.vaForeclosure, role: "supplementary", notes: "VA foreclosure — guaranty claims, purchase programs" },
      { contextId: CTX.bankruptcy, role: "supplementary", notes: "Bankruptcy proceedings — foreclosure holds and stay requirements" },
    ],
  },
];

// --- Insert ---

const insertSkill = db.prepare(`
  INSERT OR IGNORE INTO skill (id, workspace_id, name, description, instructions, applicability, tags, is_active, sort_order)
  VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
`);

const insertSkillContext = db.prepare(`
  INSERT OR IGNORE INTO skill_context (id, skill_id, context_id, role, sort_order, notes)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const insertAll = db.transaction(() => {
  skills.forEach((skill, idx) => {
    const skillId = makeId();

    insertSkill.run(
      skillId,
      WORKSPACE_ID,
      skill.name,
      skill.description,
      skill.instructions,
      JSON.stringify(skill.applicability),
      JSON.stringify(skill.tags),
      idx
    );

    console.log(`Created skill: ${skill.name} (${skillId})`);

    skill.contexts.forEach((ctx, ctxIdx) => {
      const scId = makeId();
      insertSkillContext.run(scId, skillId, ctx.contextId, ctx.role, ctxIdx, ctx.notes ?? null);
      console.log(`  → Linked context: ${ctx.role} (${ctx.contextId.slice(0, 8)}...)`);
    });
  });
});

insertAll();

// Verify
const count = db.prepare("SELECT COUNT(*) as cnt FROM skill").get() as { cnt: number };
const scCount = db.prepare("SELECT COUNT(*) as cnt FROM skill_context").get() as { cnt: number };
console.log(`\nTotal skills: ${count.cnt}`);
console.log(`Total skill-context links: ${scCount.cnt}`);

db.close();
