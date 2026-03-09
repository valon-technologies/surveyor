# 2026-03-09 Session Log

## Summary

Demo prep + stakeholder demo + post-demo improvements. Shipped 20+ changes across dashboard, review UX, generation quality, BigQuery, SOT bundling, transfer workflow, and admin stratification.

## Demo Prep (Pre-Demo)

### Dashboard Improvements
- **M2.5 milestone filter**: Dashboard defaults to M2.5, with dropdown to select All/M1/M2/M2.5/M3/M4/NR. API accepts `?milestone=` param, filters field counts, entity progress, and status distribution.
- **M1/M2 "Mapped (SOT)" display**: Milestone progress bars show M1/M2 as single teal bars labeled "Mapped (SOT)" instead of breaking down by review status.

### Review UX Changes
- **Removed checkmark/X buttons**: Review cards now only show the Discuss button — every field needs thorough review. Undo button preserved for fields already reviewed.
- **Context panel citation filter**: Splits context docs into "Cited" (referenced in reasoning via `[ref:ctx_ID]`) and collapsed "Other" section. Shows "(3 cited, 7 other)" in header.
- **Transform scroll overflow**: Added max-height + scroll to transform preview in mapping summary, verdict card, and made entire discuss page content scrollable. Fixed issue where long `np.select` transforms pushed verdict cards off-screen.

### Generation Quality
- **Reasoning prompt improvement**: Updated both JSON and YAML prompt formats to require semantic justification, not just "Direct mapping from X". Fixed the example in the prompt that the LLM was mimicking.
- **System-generated FK handling**: New prompt rule for `_id`/`_sid` fields — marks them as system-generated pass-throughs, not ACDC-sourced.
- **Full M2.5 regeneration**: 130 fields across 26 entities regenerated with improved prompts + AI pre-review. ~$30, ~2.5 hours.

### BigQuery Data Preview Fix
- **Gestalt API method fix**: `listDatasets`, `listTables`, `getTableSchema` were using POST instead of GET. Fixed `gestaltInvoke` to support both methods.
- **Dataset options updated**: Settings page now shows actual available datasets per project (service-mac-prod: `raw_acdc_m1`, `vds_production`; service-mac-stage: 6 datasets).

### Verified Mappings (Ground Truth)
- **Bundled SOT YAMLs**: Copied 397 M1/M2 YAML files (~2MB) from `sdt_mapping/acdc_to_vds/` into `data/sot/`. Path resolver prefers bundled files, falls back to local checkout. Verified Mappings page now shows 108 M1 + 113 M2 entities on production.

### Context Library
- **Mapping QA hints imported**: 83 context docs (352 field-level ACDC source hints) imported from `mapping-engine/skills-sanitized/servicemac-m1/mapping-qa-index.json`.

### Auth
- **Auto-join for @valon.com**: Any `@valon.com` email auto-joins the workspace as editor on registration — no manual invites needed.
- **New invites**: andrew@valon.com, linda@valon.com, rohith.parvathaneni@valon.com, amy.basbayar@valon.com

## Post-Demo: Transfer Workflow Improvements

### Task 1: Back Button — Browser History
- `router.back()` with fallback to hardcoded route when no history. Back button now returns to wherever you came from (discuss → discuss, discuss → queue).

### Task 2: Other Notes Persistence
- Added `ref` to notes textarea, included notes value in submit payload. Notes now saved with the review verdict.

### Task 3: Entity "Not Needed" Filter
- Entity `metadata.transferExcluded` toggle via PATCH endpoint.
- Transfer review queue filters excluded entities by default with toggle to show.
- Entity group headers have "Not needed" / "Restore" buttons.
- Review queue API includes `entityMetadata` in response.

### Task 4: Distribute + Punt for Transfers
- **Distribute**: API accepts optional `transferId` param. `DistributeDialog` supports `transferId` prop. Transfer review page has "Distribute Fields" button.
- **Punt with reassignment**: Punt API auto-reassigns to least-loaded editor. Discuss page has "Punt" button with reason dialog.

### Task 5: ACDC Context in Transfer Generation
- Transfer generation now loads ACDC enum/lookup docs (~10K token budget) as reference context.
- Explicit source constraint in prompt: "ACDC tables are REFERENCE CONTEXT ONLY — NOT valid source fields."
- Multiple sample values shown per source field.
- System-generated FK handling added to transfer prompt.
- Reasoning quality rules added to transfer prompt.

### Task 6: Context Attribution
- **Transfer generation**: Populates `mapping_context` junction table from LLM `context_used` output. Stopped storing `contextUsed` text in `notes` field.
- **Main generation**: Removed fallback that linked ALL entity context to uncited fields. Only cited docs get linked now.

### Admin Page Stratification
- Workflow toggle: "SDT Mappings" vs "Servicing Transfers" at top of admin page.
- Generation and Linear Sync tabs only show for SDT workflow.
- Corrections, Questions, Analytics tabs show for both (server-side filtering pending `transferId` column on learning/question tables).

## Known Gaps

1. **Reasoning quality for direct mappings**: YAML generation still produces terse "Direct mapping from X" notes despite prompt improvements. The example was fixed but the LLM's YAML `note:` field format biases toward brevity. Complex mappings (enum, derived, conditional) have good reasoning.
2. **Context attribution server-side**: Learning and question tables don't have `transferId` — admin page filtering is UI-only for now.
3. **Mapping QA hints not routed via skills**: 83 QA hint docs imported with `entityId` but `subcategory=domain_knowledge`, not `entity_knowledge`. Context assembler only does direct `entityId` lookup for `entity_knowledge` subcategory.
4. **Context library content gaps**: Call transcripts exist (5 docs, 124K tokens) but extract request forms (XLSX) need parsing/import.
5. **Source/transform contradiction**: Derived mappings show "unmapped" source but have real transform logic. YAML format uses `source: []` + `expression:` which the parser maps to unmapped status.

## Files Created
- `data/sot/m1_mappings/*.yaml` (196 files)
- `data/sot/m2_mappings/*.yaml` (201 files)
- `scripts/regen-for-demo.ts`
- `scripts/import-qa-hints.ts`
- `docs/2026-03-09-session-log.md`

## Files Modified (Key)
- `src/app/page.tsx` — milestone filter
- `src/app/admin/page.tsx` — workflow stratification
- `src/app/mapping/discuss/[fieldMappingId]/discuss-client.tsx` — back button, notes, punt, scroll fixes
- `src/app/transfers/[transferId]/review/page.tsx` — entity exclusion, distribute
- `src/components/dashboard/milestone-progress.tsx` — M1/M2 SOT display
- `src/components/review/review-card.tsx` — removed accept/exclude buttons
- `src/components/review/context-used-panel.tsx` — citation filter
- `src/components/review/transform-verdict-card.tsx` — scroll overflow
- `src/components/chat/mapping-state-card.tsx` — transform scroll
- `src/lib/generation/prompt-builder.ts` — reasoning, FK, example fixes
- `src/lib/generation/transfer-prompt-builder.ts` — ACDC context, FK, reasoning, samples
- `src/lib/generation/batch-runner.ts` — citation-only context linking
- `src/lib/bigquery/gestalt-client.ts` — GET/POST method fix
- `src/lib/sot/yaml-parser.ts` — bundled SOT path
- `src/app/settings/bigquery/page.tsx` — dataset options
- `src/app/api/auth/register/route.ts` — @valon.com auto-join
- `scripts/run-transfer-generation.ts` — ACDC context, mapping_context, samples
