# 2026-03-06 Session Log

## Summary

Servicing transfer mapping workflow integrated into Surveyor. Stockton portfolio fully generated with reviewer feedback loop working. American Pacific portfolio onboarded and generated. Multiple production bug fixes.

## Servicing Transfer Workflow — New Feature

Added a second workflow type to Surveyor for mapping client flat files to VDS for data onboarding. Self-contained under "Servicing Transfers" in sidebar with its own review queue per transfer.

**Schema additions:**
- `transfer` table — represents a transfer mapping project (name, client, status, stats)
- `transfer_correction` table — hard overrides (bypass LLM) and prompt injections (augment prompt)
- `field_mapping.transferId` — scopes mappings to a transfer (null = VDS Review)
- `field.position`, `field.requirementType`, `field.requirementDetail` — transfer source metadata

**Workflow isolation:** All existing VDS Review routes filter `isNull(fieldMapping.transferId)` so transfer mappings never appear in the reviewer experience. Modified: dashboard, review-queue, fields, members/stats, mappings/distribute routes.

**UI:**
- `/transfers` — list page showing all transfers with coverage stats
- `/transfers/[id]` — detail page with stats cards, corrections count, export link
- `/transfers/[id]/review` — self-contained review queue with status/confidence/entity filters
- Sidebar: "Servicing Transfers" with expandable children
- Discuss page: "Prior Versions" panel showing mapping history with verdicts
- Back navigation from discuss page returns to transfer review queue (not /mapping)

**Generation engine:**
- Domain-based batching (tier 1 data domains vs tier 2 workflow domains)
- VDS-first prompt: "For each VDS field, find the best source from the flat file"
- Corrections engine: hard overrides bypass LLM, prompt injections augment prompt
- Context loading: foundational docs (~7K tokens), entity skill docs (capped 20K/domain), workspace learnings
- Copy-on-write versioning on re-runs — prior mappings + verdicts preserved
- Cost controls: `--dry-run`, `--domain` filter, per-domain cost breakdown
- Streaming for large outputs (>16K maxTokens) to avoid Anthropic SDK 10-min timeout

## Stockton Portfolio

**Source:** 440 fields from `stockton-fields.csv`

**Feedback import:** 1,915 rows from reviewed Excel (`vds-stockton-coverage_2026-02-25_1252.xlsx`)
- 1,590 confirmed correct
- 325 with corrections → imported as transfer_correction records

**Generation runs:**
| Run | Fields | Cost | Notes |
|-----|--------|------|-------|
| v1 (no context) | 941 | $12.36 | Empty skillsText/learningsText |
| v2 (ARM test) | 35 | $0.64 | Verified corrections work |
| v3 (full, with context + corrections) | 896 | $21.15 | 324 prompt injections applied |
| v3 truncation fix (accounting, loans, payments) | 375 | $7.19 | 32K output + streaming |
| Override application | 147 | $0 | Mechanical, no LLM |

**Corrections issues discovered and fixed:**
- Import script classified 50/51 hard overrides with `hasMapping: false` — all were broken
- Reclassified to prompt injections, then 180 ignored prompt injections converted to hard overrides with extracted default values (literal: 0.00, literal: true, etc.)
- Added default-value override support to corrections engine (no source field required)

**Flow Transfer Principles:** Distilled 8 categories of transferable principles from Garrett's feedback into `data/transfers/flow-transfer-principles.md` for reuse across portfolios.

## American Pacific Portfolio

**Source:** 261 fields from `American Pacific File Layout.xlsx` (single sheet, field names in row 1, samples in row 2)

**Generation:** 1,005 mappings across 20 domains, ~$20, zero errors, zero truncation.

## M2.5 Gap Fill

Ran gap-fill for 184 M2.5 fields missing mapping records (output truncation from original generation). Used existing batch runner with `includeStatuses: ["unmapped"]` and milestone filter. Filled 22 of 184 — remaining gaps are entities not structured for batch runner's entity-level generation.

## Bug Fixes

**`findSimilarMappings` missing await** (pre-existing): The ripple/similar route called async `findSimilarMappings()` without `await`, returning a Promise object. Caused client crash when reviewers clicked accept/checkmark button.

**Submit button blocked when no question exists:** `questionDecision` stayed `false` when there was no linked question and no AI-suggested question. Added auto-resolve effect so only source + transform decisions are needed.

**Back navigation hardcoded to /mapping:** Back button, Exclude, and Submit Review & Next all now route to `/transfers/[id]/review` when viewing a transfer mapping.

**Streaming for large outputs:** Claude provider now auto-switches to streaming when `maxTokens > 16384` to avoid Anthropic SDK's 10-minute timeout.

## Files Created

| File | Purpose |
|------|---------|
| `src/lib/import/transfer-source-parser.ts` | Parse flat file CSV + requirement data |
| `src/lib/transfer/requirement-matcher.ts` | Fuzzy-match VDS fields to requirement data |
| `src/lib/transfer/domain-config.ts` | Tier classification, skill paths, pricing |
| `src/lib/transfer/corrections-engine.ts` | Load/apply corrections during generation |
| `src/lib/generation/transfer-prompt-builder.ts` | VDS-first transfer prompt |
| `src/lib/generation/transfer-output-parser.ts` | Parse + resolve transfer LLM output |
| `src/app/api/workspaces/.../transfers/` | 6 API routes (CRUD, corrections, export, coverage) |
| `src/app/transfers/page.tsx` | Transfer list page |
| `src/app/transfers/[id]/page.tsx` | Transfer detail page |
| `src/app/transfers/[id]/review/page.tsx` | Self-contained transfer review queue |
| `src/components/transfer/create-transfer-dialog.tsx` | Transfer creation UI |
| `src/components/transfer/mapping-history-panel.tsx` | Prior versions panel for discuss page |
| `scripts/run-transfer-generation.ts` | Domain-based generation with cost controls |
| `scripts/import-transfer-feedback.ts` | Import feedback Excel into corrections |
| `scripts/apply-overrides-only.ts` | Mechanical override application ($0) |
| `scripts/convert-ignored-to-overrides.ts` | Reclassify failed prompt injections |
| `data/transfers/flow-transfer-principles.md` | Transferable principles for all portfolios |

## Files Modified

| File | Change |
|------|--------|
| `src/lib/db/schema.ts` | transfer + transfer_correction tables, transferId columns |
| `src/lib/llm/providers/claude.ts` | Auto-streaming for large outputs |
| `src/components/layout/sidebar-nav.tsx` | "Servicing Transfers" nav item |
| `src/app/mapping/discuss/.../discuss-client.tsx` | History panel, back nav, question auto-resolve |
| `src/app/api/.../review-queue/route.ts` | transferId filter |
| `src/app/api/.../dashboard/route.ts` | isNull(transferId) isolation |
| `src/app/api/.../fields/route.ts` | isNull(transferId) isolation |
| `src/app/api/.../members/.../stats/route.ts` | isNull(transferId) isolation |
| `src/app/api/.../mappings/distribute/route.ts` | isNull(transferId) isolation |
| `src/app/api/.../mappings/[id]/history/route.ts` | Full verdicts + transferId scoping |
| `src/app/api/.../mappings/[id]/ripple/similar/route.ts` | Missing await fix |
| `src/types/mapping.ts` | Added transferId to FieldMapping type |
| `.vercelignore` | Added /data/ |

## Spend Summary

| Item | Cost |
|------|------|
| Stockton generation (all runs) | ~$41 |
| American Pacific generation | ~$20 |
| **Total this session** | **~$61** |

## Next Steps

1. Garrett reviews American Pacific mappings in Surveyor
2. Onboard remaining 5 portfolios (same pipeline: upload CSV → generate → review)
3. After review, convert confirmed corrections to hard overrides to prevent regression
4. Feed Garrett's new corrections back into flow-transfer-principles.md for cross-portfolio learning
