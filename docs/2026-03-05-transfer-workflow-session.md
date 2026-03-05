# 2026-03-05 Session: Transfer Mapping Workflow

## Summary

Added "Servicing Transfer" workflow to Surveyor — a second workflow type alongside VDS Review for mapping client flat files (e.g., Stockton's 440-field loan file) to VDS for data onboarding.

## Architecture Decisions

- **Workflow type within workspace** (not separate workspaces) — transfers share VDS skills, domain knowledge, and target schema with VDS Review
- **Corrections table separate from learning table** — `transfer_correction` (per-transfer, client-specific) vs `learning` (workspace-wide, universal)
- **Workflow isolation** — transfer mappings scoped by `transferId` on `field_mapping`; review queue filters by transfer; context assembly pipelines are independent

## Schema Changes

**New tables:**
- `transfer` — represents a transfer mapping project (name, client, status, stats, source schema link)
- `transfer_correction` — hard overrides (bypass LLM) and prompt injections (augment prompt), scoped per-transfer

**Column additions:**
- `field_mapping.transferId` — scopes mappings to a transfer (null = VDS Review)
- `field.position` — flat file position for transfer source fields
- `field.requirementType` / `field.requirementDetail` — onboarding requirement annotations
- `generation.transferId` / `batch_run.transferId` — generation audit trail

## Transfer Source Parser + Requirement Matcher

- `src/lib/import/transfer-source-parser.ts` — parses flat file CSV (position, field_name, sample_value) and requirement data CSV
- `src/lib/transfer/requirement-matcher.ts` — fuzzy-matches VDS entity.field to data-dict requirement fields (ported from Python)

## API Routes

| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/workspaces/[wsId]/transfers` | GET, POST | List + create transfers |
| `/api/workspaces/[wsId]/transfers/[tId]` | GET, PATCH, DELETE | Transfer CRUD |
| `/api/workspaces/[wsId]/transfers/[tId]/corrections` | GET, POST | Corrections CRUD |
| `/api/workspaces/[wsId]/transfers/[tId]/corrections/[cId]` | PATCH, DELETE | Correction update/delete |
| `/api/workspaces/[wsId]/transfers/[tId]/export` | GET | CSV export |
| `/api/workspaces/[wsId]/transfers/[tId]/coverage` | GET | Coverage stats by domain |

## UI

- `/transfers` — list page with table and "New Transfer" button
- `/transfers/[transferId]` — detail page with stats cards, corrections list, export/review links
- `CreateTransferDialog` — modal with CSV upload, preview, requirement data import
- Sidebar nav — "Transfers" item added with ArrowRightLeft icon

## Generation Engine

**New files:**
- `src/lib/transfer/domain-config.ts` — tier classification, skill paths, pricing constants
- `src/lib/generation/transfer-prompt-builder.ts` — VDS-first prompt (flat source, domain batching, corrections injection)
- `src/lib/generation/transfer-output-parser.ts` — JSON parse, field resolution, hallucination detection
- `src/lib/transfer/corrections-engine.ts` — load corrections, build prompt context, apply hard overrides

**Cost controls:**
- `--dry-run` shows estimated cost without calling LLM
- `--domain` filters to single domain for testing
- Hard overrides bypass LLM entirely (free)
- Per-domain cost breakdown in estimates

## Feedback Import

**Script:** `scripts/import-transfer-feedback.ts`

Reads the reviewed Excel workbook, classifies each row:
- Confirmed correct (1,590) → verdict updates when mappings exist
- Hard overrides (51) → bypass LLM on regeneration
- Prompt injections (274) → augment LLM prompt with reviewer guidance
- All 325 corrections imported into `transfer_correction` table

## Stockton Test Results

- **Transfer created:** 440 source fields from stockton-fields.csv
- **Corrections imported:** 325 (51 hard overrides + 274 prompt injections)
- **ARM domain test run:** 35 mappings created, $0.64, 88 seconds
- **Full tier-1 generation:** running (20 domains, ~954 fields, estimated ~$19 with Opus)

## Data Files

Stockton source data copied into Surveyor repo at `data/transfers/stockton/`:
- `stockton-fields.csv` — 440 source fields
- `data-dict-required-fields.csv` — 537 requirement fields
- `feedback.xlsx` — reviewed Excel with 1,915 verdicts + 325 corrections
- `corrections.json` — original 21 manually transcribed corrections

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/test-transfer-flow.ts` | Create test transfer, verify DB records |
| `scripts/import-transfer-feedback.ts` | Import feedback Excel into corrections |
| `scripts/run-transfer-generation.ts` | Domain-by-domain generation with cost controls |

## Next Steps

1. Wait for full generation to complete
2. Get 6 other portfolio source files → create transfers for each
3. Sprint 3: Review UX adaptations (transfer source panel on discuss page, review queue filter, coverage dashboard)
4. Sprint 4: Export, analytics, deploy to Vercel
