/**
 * Fuzzy-match VDS entity.field names to data-dict requirement field names.
 *
 * Ported from Python map_vds_from_stockton.py match_vds_to_data_dict().
 */

import type { RequirementField } from "@/lib/import/transfer-source-parser";

/**
 * Known entity → field prefix patterns.
 * When exact and entity-prefixed matches fail, try these.
 */
const ENTITY_PREFIX_MAP: Record<string, string> = {
  arm_loan_info: "arm_",
  arm_rate_period: "arm_",
  borrower: "borrower_",
  borrower_to_loan: "borrower_",
  property: "property_",
  mortgage_insurance: "mortgage_insurance_",
  flood_info: "flood_",
  heloc_loan_info: "heloc_",
  heloc_draw: "heloc_draw_",
  bankruptcy_case: "bankruptcy_",
  escrow_analysis: "escrow_",
  escrow_loan_info: "escrow_",
};

export interface RequirementMatch {
  requirementType: string;
  requirementDetail: string;
}

/**
 * Try to match a VDS entity.field to a data-dict requirement field.
 *
 * Matching heuristics (in order):
 * 1. Exact match on field name
 * 2. Entity-prefixed match: {entity}_{field}
 * 3. Known entity-specific prefix patterns
 */
export function matchRequirementType(
  vdsEntity: string,
  vdsField: string,
  lookup: Map<string, RequirementField>,
): RequirementMatch | null {
  // 1. Exact match on field name
  const exact = lookup.get(vdsField);
  if (exact) {
    return {
      requirementType: exact.requirementType,
      requirementDetail: exact.requirementDetail,
    };
  }

  // 2. Entity-prefixed match
  const prefixed = lookup.get(`${vdsEntity}_${vdsField}`);
  if (prefixed) {
    return {
      requirementType: prefixed.requirementType,
      requirementDetail: prefixed.requirementDetail,
    };
  }

  // 3. Known entity prefix patterns
  const prefix = ENTITY_PREFIX_MAP[vdsEntity];
  if (prefix) {
    const byPrefix = lookup.get(`${prefix}${vdsField}`);
    if (byPrefix) {
      return {
        requirementType: byPrefix.requirementType,
        requirementDetail: byPrefix.requirementDetail,
      };
    }
  }

  return null;
}
