# Session Log — 2026-03-12

## Summary

Two major items: MAP-856 (transform accuracy eval + SOT Accuracy UI) deployed. MAP-893 (context optimization) to fix generation failures — moved large docs to RAG-only, added primary context cap. Restored 90 retired M2.5 mappings and running gap-fill generation for remaining 105 fields.

---

## Tickets Completed

| Ticket | Feature | Commit |
|---|---|---|
| MAP-856 | Opus transform accuracy eval + enhanced SOT Accuracy UI | `ea27cff` |
| MAP-893 | Context optimization — RAG-only threshold + primary cap | `ab244c0` |

## Tickets Created

| Ticket | Title | Priority |
|---|---|---|
| MAP-890 | Create Remotion video for Surveyor | Medium |
| MAP-891 | Updated roadmap for Surveyor | High |
| MAP-892 | Users need a way to revert servicing transfer field exclusions | High |
| MAP-893 | More efficient context management for generation | Medium |

## Linear Cleanup

- MAP-889 → Canceled (duplicate of completed MAP-888: transfer chat ACDC bleed)
- MAP-884 → Canceled (entity/field exclusion already implemented via metadata toggle + status)
- MAP-856 → Completed

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

## M2.5 Field Gap Fix

**Problem:** Only 104/321 M2.5 fields visible in review queue.

**Root causes:**
- **Case 1 (107 fields):** Never generated — no fieldMapping records at all
- **Case 2 (90 fields):** Had mappings, all retired (isLatest=false) by batch runner during re-generation when LLM omitted fields from output

**Fixes applied:**
1. Restored 90 retired mappings → `scripts/restore-retired-m25.ts` (instant, no cost)
2. Context optimization (MAP-893) to fix generation failures:
   - Docs >10K tokens moved to RAG-only (18 docs, 587K tokens removed from worst-case prompts)
   - 40K soft cap on primary context (EK corrections prioritized)
3. Gap-fill generation running for remaining 105 fields across 12 entities

**M2.5 review queue progress:**
- Started: 104 / 321
- After restore of 90 retired mappings: 214
- After context optimization + direct runner gap fill: **299 / 321**
- Remaining 30 fields in 2 entities (`loss_mitigation_payment_deferral` 21, `foreclosure` 9) — retrying
- `attempt_status` on `property_conveyance_attempt` confirmed generated

**Key fix:** Rewrote `fill-m25-gaps.ts` to use direct `runGeneration()` with explicit `fieldIds` instead of the batch runner. The batch runner's `prepareEntityForRegeneration` retires ALL entity mappings before generating — when the LLM omits fields from output, the old mappings stay retired with no replacement. Direct runner avoids this by not retiring anything.

**Issues found during gap fill:**
- Batch runner retire-then-generate pattern causes collateral damage on partial LLM output (had to restore retired mappings 3 times)
- `loss_mitigation_payment_deferral`: LLM parsed 4200 output tokens but no mappings resolved — possible output parser field name mismatch
- `foreclosure`: stale generation lock from prior run prevented re-generation (cleared on next attempt)

## Context Optimization (MAP-893)

**Problem:** Generation hitting 1M+ input tokens → prompt-too-long failures (7 entities) + LLM field omission (6 entities)

**Root cause:** 18 context docs over 10K tokens (587K total) packed into every prompt:
- Extract requests: 103K, 50K, 33K
- Jacksonville onsite transcripts: 5 docs, 19-37K each
- Q&A docs: 44K, 43K, 19K
- Regulatory/table docs: 19K, 17K, 16K, 11K

**Fix:** Dynamic RAG-only threshold (10K tokens) + 40K primary context soft cap. Large docs still available via FTS5 search on demand.

## Investigation: CMG VDS Field Count (1,005 vs 2,816)

**Not a bug — by design.** The `totalTargetFields: 1005` in CMG transfer stats reflects tier 1 domains only (default generation scope).

- **2,816** total VDS target fields across 231 entities
- **2,115** after removing system fields (id, created_at, etc.)
- **1,005** in tier 1 domains (data: loans, borrower, escrow, payments, etc.)
- **~1,110** in tier 2 domains (workflow: bankruptcy, foreclosure, loss mitigation, etc.)

Tier 1 = "domains where a loan-level flat file plausibly provides data" — appropriate for servicing transfers. Tier 2 requires explicit `--tier 2` flag and uses Haiku.

**Action item:** Raise tomorrow — should the VDS Fields stat card show total (all tiers) for context, or is tier-1-only count correct for transfer scope?

---

## Still TODO

1. **Regenerate SDT mappings with `EXCLUDE_SOT=1`** — unbiased generation without SOT YAML as context
2. **Re-run full eval** (`npx tsx scripts/run-sot-eval.ts --include-transform`) — get clean accuracy numbers
3. Raise CMG VDS field count question (tier 1 vs all tiers)
4. **MAP-892** — revert servicing transfer field exclusions UI
5. **MAP-891** — updated Surveyor roadmap

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
