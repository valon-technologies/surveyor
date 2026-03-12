# Session Log — 2026-03-12

## Summary

Implemented MAP-856: Opus-based transform accuracy evaluation with enhanced SOT Accuracy UI. Fixed a transfer mapping bleed bug in the evaluator. Full eval run across 116 entities in progress (~$17).

---

## Tickets Completed

| Ticket | Feature | Commit |
|---|---|---|
| MAP-856 | Opus transform accuracy eval + enhanced SOT Accuracy UI | `ea27cff` |

## Linear Cleanup

- MAP-889 → Canceled (duplicate of completed MAP-888: transfer chat ACDC bleed)
- MAP-884 → Canceled (entity/field exclusion already implemented via metadata toggle + status)
- MAP-890 → Created (Remotion video for Surveyor), Needs Implementation
- MAP-856 → In Progress → deployed

## Key Changes (MAP-856)

### Transform Evaluation Engine
- New `src/lib/evaluation/transform-evaluator.ts` — ports Opus eval prompt from mapping-engine's Python `transform_evaluator.py`
- SOT YAML chain loader: reads VDS YAML + recursively loads staging component YAMLs
- Response parsing with markdown fence handling and bracket fallback
- Transform capping logic: source DISJOINT→force WRONG, SUBSET/SUPERSET→cap PARTIAL

### Bug Fix: Transfer Mapping Bleed
- `mapping-evaluator.ts` was picking up transfer mappings (null sourceEntityId) instead of SDT mappings when building genSources
- Root cause: multiple `isLatest=true` mappings per field from different transfer generations, `Map` constructor keeping last (transfer) entry
- Fix: added `isNull(fieldMapping.transferId)` filter to scope evaluator to SDT-only mappings
- Result: `loan` source accuracy went from 0% → 51.2%

### Enhanced SOT Accuracy UI
- 4-6 stat cards: source exact, source lenient, transform exact, transform lenient
- M1/M2/All milestone toggle filter
- Entity table with transform columns, milestone badges (M1, M2, M1+M2)
- Scrollable field-level grid: SOT source/transform vs generated source/transform
- Click-to-expand transform comparison explanation from Opus
- Sortable by field name, source match, or transform match
- Sticky headers, 600px max scroll

### Schema
- 4 new nullable columns on `sotEvaluation`: `transform_exact_count`, `transform_lenient_count`, `transform_exact_pct`, `transform_lenient_pct`

## Data Operations

- **Full eval run canceled at ~50/116 entities** (~$7.50 spent)
- Results are **tainted**: SOT YAML is fed as "Production Mapping Reference" during generation (lines 353-382 of `runner.ts`), so accuracy measures "can the LLM reproduce what it was shown" not blind accuracy
- `EXCLUDE_SOT=1` env var exists to suppress SOT from generation context, but is off by default
- **To get unbiased accuracy:** regenerate mappings with `EXCLUDE_SOT=1`, then re-run eval
- Single entity test results (tainted — SOT in context):
  - `loan`: src 51.2%/79.1%, txfm 23.3%/67.4% (43 fields)
  - `loss_mitigation_loan_modification`: src 75.0%/75.0%, txfm 70.0%/95.0% (20 fields)

## Investigation: CMG VDS Field Count (1,005 vs 2,816)

**Not a bug — by design.** The `totalTargetFields: 1005` in CMG transfer stats reflects tier 1 domains only (default generation scope).

- **2,816** total VDS target fields across 231 entities
- **2,115** after removing system fields (id, created_at, etc.)
- **1,005** in tier 1 domains (data: loans, borrower, escrow, payments, etc.)
- **~1,110** in tier 2 domains (workflow: bankruptcy, foreclosure, loss mitigation, etc.)

Tier 1 = "domains where a loan-level flat file plausibly provides data" — appropriate for servicing transfers. Tier 2 requires explicit `--tier 2` flag and uses Haiku.

**Action item:** Raise tomorrow — should the VDS Fields stat card show total (all tiers) for context, or is tier-1-only count correct for transfer scope?

---

## Next Session TODO

1. **Regenerate SDT mappings with `EXCLUDE_SOT=1`** — unbiased generation without SOT YAML as context
2. **Re-run full eval** (`npx tsx scripts/run-sot-eval.ts --include-transform`) — get clean accuracy numbers
3. Raise CMG VDS field count question (tier 1 vs all tiers)

---

## Remaining Tickets (17 Needs Implementation)

### High Priority
| Ticket | Title |
|---|---|
| MAP-858 | Generate mappings for M3 VDS fields |
| MAP-847 | BigQuery validation step — compare ACDC source vs VDS output |

### Medium Priority
| Ticket | Title |
|---|---|
| MAP-846 | Import DataDict legacy mappings as context |

### Low Priority (14)
MAP-835, MAP-834, MAP-837, MAP-838, MAP-839, MAP-840, MAP-842, MAP-844, MAP-849, MAP-850, MAP-853, MAP-879, MAP-883, MAP-890
