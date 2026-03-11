# 2026-03-10 Session Log

## Summary

Continued from 3/9 session. Formal Linear ticketing established. 11 tickets completed (Tier 1 + Tier 2), transfer AI review fixed, new M2.5 fields imported, multiple new Linear issues created for roadmap tracking.

## Linear Ticketing Workflow Established

Created 24 tickets (MAP-819–845) in [Surveyor UX Feedback](https://linear.app/valon/project/surveyor-ux-feedback-411c9560909f) project across 4 priority tiers. Consolidated 6 duplicates from the feedback agent. Going forward: all Surveyor edits tracked in Linear, updated to In Progress when starting, Completed with implementation comment when deployed.

## Tier 1 Bug Fixes (Completed)

**MAP-819: App freezing / AI assistant timeouts**
- Added 2-min AbortController timeout on chat stream
- Shows "timed out, please try again" instead of freezing indefinitely
- `isStreaming` always resets in finally block

**MAP-820: Can't submit review with question only**
- `canSubmit` now allows submission when field is unmapped and a question decision was made, without requiring source/transform verdicts

**MAP-821: Cross-queue bleed (Premier → CMG)**
- Sibling navigation now filters by `transferId` so Submit & Next stays within the same transfer
- Entity detail API includes `transferId` in field mapping response
- `FieldWithMapping` type updated

**MAP-822: Filters reset on page refresh**
- Transfer review page persists all filters (status, confidence, entity, assignee, search, excluded, hideSystem) in URL search params

## Tier 2 Fixes (Completed)

**MAP-823: Filter out system-generated FK fields**
- `hideSystemFields` toggle (default ON) in both SDT (Zustand store) and transfer (URL params) review queues
- Hides `_id`/`_sid` fields with unmapped status

**MAP-827: Allow revisiting reviewed items**
- Already functional — status filter chips include accepted/excluded

**MAP-828: Import extract request forms**
- 5 XLSX files imported as context docs (272K tokens total)
- Script: `scripts/import-extract-forms.ts`

**MAP-829: Source/transform contradiction on derived fields**
- YAML + JSON output parsers detect `alias.Column` references in expressions
- Derived fields with real logic no longer classified as "unmapped"

**MAP-830: Linear ticket reference for transfers**
- UI wired (purple box renders when `linearIssueId` in field metadata)
- Reverted to In Progress — transfer fields need Linear data synced first

**MAP-831: My claimed fields filter**
- Assignee filter (All / My fields / Unclaimed) in both workflows
- Transfer: URL param. SDT: Zustand store.

**MAP-832: Auto-save notes on blur**
- Notes textarea saves immediately on blur via mapping PATCH endpoint

## Additional Tickets Completed

**MAP-848: Submit Review & Next ignores active filters**
- Both review queues persist filtered mapping IDs to sessionStorage
- Discuss page reads queue order for Skip, Submit & Next, and Punt navigation
- Falls back to entity-level siblings when no queue order stored

**MAP-855: AI review pass overwrites transfer sources with ACDC fields**
- Created transfer-aware AI review prompt (TRANSFER_REVIEW_SYSTEM_PROMPT)
- Loads flat file source fields into prompt context
- Constrains source suggestions to flat file only
- SDT continues using ACDC-aware prompt
- Re-ran 208 corrupted AI reviews with fixed prompt (~$6)

## New M2.5 Field Import

- Synced Linear M2.5 dashboard: 29 fields updated with Linear reference data, 54 excluded (Descoped/Canceled)
- Identified 21 new fields via Linear parent issues (entity = parent issue title)
- Created 2 new entities: `loss_mitigation_application_completeness_evaluation`, `mortgage_assistance_application_to_application_individual`
- Imported 15 new fields (15 already existed). Total M2.5 fields: 321

## New Linear Issues Created (Roadmap)

| ID | Title | Priority |
|-----|-------|----------|
| MAP-846 | Import DataDict legacy mappings for ST context | Medium |
| MAP-847 | BigQuery validation — compare ACDC vs VDS for SDT | High |
| MAP-849 | Validate ST mapping export for IO converter | Low |
| MAP-850 | Validate SDT mappings for implementation handoff | Low |
| MAP-853 | Define required VDS subset for servicing transfers | Low |
| MAP-855 | AI review pass overwrites transfer sources (fixed) | Urgent |
| MAP-856 | Measure source + transform accuracy against M1/M2 SOT | High |
| MAP-857 | Client answer integration workflow for context enrichment | High |
| MAP-858 | Generate mappings for M3 VDS fields | High |
| MAP-859 | Sync new M2.5 SDT fields from Linear (done) | Urgent |

## Session 2: Generation, Scripts, Client Q&A, Demo Prep

### Tickets Closed (13 total this session)
MAP-768 (feedback loop — working as designed), MAP-830 (Linear reference), MAP-833 (client source badge), MAP-836 (reasoning quality), MAP-841 (entity exclusion button), MAP-843 (punt note required), MAP-845 (leaderboard empty), MAP-851, MAP-852, MAP-854, MAP-857 (client Q&A), MAP-859 (M2.5 sync), MAP-860 (transfer AI reviews)

### M2.5 Gap Fill Generation
- 225 gap fields across 37 entities identified
- First attempt via batch runner failed: all 37 entities hit "prompt too long" (200K+) because source schema was 75K tokens unbounded
- **No money spent** — API rejected all requests at 400 before processing
- Fixed: capped non-relevant source schema at 40K tokens in runner.ts
- Second attempt succeeded: ~20 entities generated, rest failed on stale "running" records (cleaned up)
- 153 AI reviews generated, 0 errors

### Batch Runner Bugs Fixed
1. **Silent error swallowing** — entity failures now logged with error message
2. **Mapping rollback on failure** — retired mappings restored if generation fails
3. **Source schema cap** — non-relevant tables limited to 40K tokens

### Unified Scripts (MAP-861)
- `scripts/generate.ts` — SDT + transfer generation with --milestone, --gaps-only, --entity, --with-reviews, --transfer, --dry-run
- `scripts/review.ts` — AI review pass with --milestone, --entity, --transfer, --all, --missing-only, --fix-acdc, --dry-run
- Replaces 5+ ad-hoc scripts

### Client Q&A Workflow (MAP-857)
- Extracted `resolveQuestion()` shared helper from resolve API route
- New admin "Client Q&A" tab (SDT only) with curation UI
- Export selected questions as XLSX for client
- Import completed XLSX with client answers → creates pending learnings
- Client-sourced learnings get "Client answer" badge on Corrections tab

### System Field Filter Expansion
- Shared `isSystemField()` util catches: bare `id`, `_id`/`_sid` suffixes, `created_at`/`updated_at`/`deleted_at`
- ~449 additional system fields now hidden by default
- Entity exclusion X button added to transfer review queue headers

### Transfer Review Sheet Export
- `scripts/export-transfer-review-sheet.ts` — generates XLSX for offline transfer review
- Pre-populated with AI mapping data, reviewer fills in verdicts/corrections
- Generated Premier sheet (940 rows)

### Coverage Inventory (post-generation)
| Milestone | Fields | Mapped | AI Review | Accepted | Gap |
|-----------|--------|--------|-----------|----------|-----|
| M1 | 497 | 400 | 147 | 45 | 97 |
| M2 | 200 | 148 | 56 | 19 | 52 |
| M2.5 | 356 | 157 | 88 | 43 | 199 |

### Demo Prep
- Dashboard: fixed COUNT(DISTINCT) inflation, DISTINCT ON subquery for milestone bars, coverage % to 2 decimal places
- Dashboard: moved milestone dropdown into stats bar, Milestone Coverage above it
- Dashboard: entity progress table shows entity.name instead of description-as-displayName
- Sidebar: renamed "Mapping" → "SDT Mapping"
- Sidebar: transfer portfolios expand directly to review queues (dynamic from API)
- Review cards: colored left border + status badge on every card (was hidden for unmapped/unreviewed)
- Entity exclusion: "Not needed for ST" text button replaces X icon
- System field filter: expanded to catch bare `id`, `created_at`, `updated_at`, `deleted_at` (~449 fields)
- Removed ascending/descending sort dropdown from SDT queue
- "Other Notes" → "Other Info" on discuss page
- AI review prompt: questions required for medium/low confidence mappings
- Vercel: manual deploy via `npm run deploy` (git integration disconnected)
- SOT data: .vercelignore fixed to include data/sot/ (was excluded, breaking Verified Mappings)
- SOT display: section headers show "M1 (108 entities, 1009 fields)" format

### New Linear Issues
| ID | Title | Priority |
|-----|-------|----------|
| MAP-861 | Standardize generation/review scripts (done) | High |
| MAP-862 | Parse extract request forms into per-entity context docs | High |
| MAP-863 | Import Jacksonville onsite transcripts as context | High |
| MAP-864 | Fix entity displayName containing descriptions (done) | Low |
| MAP-865 | Extract learnings from AI chat sessions into admin queue | High |

### Additional Tickets Closed (Session 2)
MAP-768 (feedback loop — working as designed), MAP-830, MAP-833, MAP-836, MAP-841, MAP-843, MAP-845, MAP-851, MAP-852, MAP-854, MAP-857, MAP-859, MAP-860, MAP-864

## Scripts Created
- `scripts/fix-transfer-ai-reviews.ts` — re-run corrupted transfer AI reviews
- `scripts/import-new-m25-fields.ts` — import fields from Linear with parent-based entity resolution
- `scripts/import-extract-forms.ts` — parse XLSX and import as context docs
- `scripts/generate.ts` — unified generation CLI
- `scripts/review.ts` — unified AI review CLI
- `scripts/export-transfer-review-sheet.ts` — transfer review XLSX export

## Files Modified (Key)
- `src/lib/hooks/use-chat-stream.ts` — timeout + error handling
- `src/lib/generation/ai-review.ts` — transfer-aware review prompt
- `src/lib/generation/output-parser.ts` — derived field status fix
- `src/app/mapping/discuss/[fieldMappingId]/discuss-client.tsx` — question submit, queue-aware nav, skip
- `src/app/transfers/[transferId]/review/page.tsx` — URL param filters, system field toggle, queue order
- `src/stores/review-store.ts` — assignee filter, hideSystemFields
- `src/components/review/review-queue-list.tsx` — assignee filter, system field filter, queue order
- `src/types/field.ts` — transferId on FieldWithMapping
