/**
 * Domain classification and skill mapping for transfer workflows.
 * Ported from Python map_vds_from_stockton.py.
 */

/** Tier 1: domains where a loan-level flat file plausibly provides data. */
export const TIER1_DOMAINS = new Set([
  "accounting",
  "agency_reporting",
  "arm",
  "borrower",
  "claims",
  "collateral",
  "compliance_reporting",
  "entities",
  "escrow",
  "heloc",
  "investor",
  "invoices",
  "loans",
  "mortgage_insurance",
  "payments",
  "prepayment_penalty",
  "property",
  "property_insurance",
  "special_loans",
  "tax",
]);

/** System fields excluded from mapping. */
export const SYSTEM_FIELDS = new Set([
  "created_at", "updated_at", "deleted_at", "deletion_reason", "id", "sid",
]);

/** Domain → VDS entity skill paths (for context loading). */
export const DOMAIN_SKILL_PATHS: Record<string, string[]> = {
  loans: [
    "core-loan/loan", "core-loan/loan-at-origination-info",
    "core-loan/loan-at-data-transfer-info", "core-loan/loan-to-property",
    "core-loan/loan-to-portfolio", "core-loan/loan-document",
    "core-loan/special-loan-types",
  ],
  borrower: [
    "borrower-party/borrower", "borrower-party/borrower-to-loan",
    "borrower-party/borrower-phone-number", "borrower-party/borrower-credit-score",
    "borrower-party/borrower-extensions",
  ],
  entities: ["borrower-party/address"],
  property: [
    "property/property", "property/property-valuation",
    "property/property-management",
  ],
  arm: ["arm/arm-rate-period", "arm/arm-index-rate"],
  escrow: [
    "escrow/escrow-analysis", "escrow/escrow-disbursement",
    "escrow/escrow-schedule", "escrow/banking-escrow-details",
  ],
  heloc: ["heloc/heloc-draw"],
  mortgage_insurance: [
    "insurance/mortgage-insurance", "insurance/mortgage-insurance-billing",
    "insurance/mortgage-insurance-company", "insurance/mortgage-insurance-installment",
    "insurance/mortgage-insurance-cancellation-case",
  ],
  property_insurance: ["insurance/property-insurance", "insurance/flood-info"],
  tax: [
    "tax/loan-tax-info", "tax/loan-tax-installment", "tax/loan-tax-line",
    "tax/loan-tax-parcel", "tax/tax-authority", "tax/tax-option",
  ],
  investor: [
    "investor-agency/portfolio", "investor-agency/mbs-pool",
    "investor-agency/loan-to-portfolio", "investor-agency/investor-reporting",
  ],
  payments: [
    "payment-financial/loan-payment", "payment-financial/payment-schedules",
    "payment-financial/loan-payment-amortization-schedule",
    "payment-financial/banking-activity", "payment-financial/banking-transactions",
    "payment-financial/payoff-payment",
  ],
  collateral: [
    "investor-agency/collateral-file-custodian",
    "core-loan/loan-lien-release",
  ],
  special_loans: ["core-loan/loan-assumption", "core-loan/special-loan-types"],
  accounting: ["core-loan/loan-accounting-balance"],
  claims: ["investor-agency/agency-claim", "investor-agency/agency-claim-details"],
  compliance_reporting: [
    "credit-reporting/credit-reporting-records",
    "credit-reporting/credit-bureau-report",
  ],
  agency_reporting: ["investor-agency/investor-reporting"],
  invoices: ["core-loan/loan-expense", "core-loan/loan-fee"],
  prepayment_penalty: ["legal/legal-compliance"],
};

/**
 * Pricing per 1M tokens (approximate, Opus pricing as of 2026-03).
 * Used for cost estimation only.
 */
export const TOKEN_PRICING = {
  "claude-opus-4-6": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 0.80, output: 4 },
} as const;

export type ModelId = keyof typeof TOKEN_PRICING;

export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  model: ModelId = "claude-opus-4-6",
): number {
  const p = TOKEN_PRICING[model] || TOKEN_PRICING["claude-opus-4-6"];
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}
