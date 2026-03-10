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

## Scripts Created
- `scripts/fix-transfer-ai-reviews.ts` — re-run corrupted transfer AI reviews
- `scripts/import-new-m25-fields.ts` — import fields from Linear with parent-based entity resolution
- `scripts/import-extract-forms.ts` — parse XLSX and import as context docs

## Files Modified (Key)
- `src/lib/hooks/use-chat-stream.ts` — timeout + error handling
- `src/lib/generation/ai-review.ts` — transfer-aware review prompt
- `src/lib/generation/output-parser.ts` — derived field status fix
- `src/app/mapping/discuss/[fieldMappingId]/discuss-client.tsx` — question submit, queue-aware nav, skip
- `src/app/transfers/[transferId]/review/page.tsx` — URL param filters, system field toggle, queue order
- `src/stores/review-store.ts` — assignee filter, hideSystemFields
- `src/components/review/review-queue-list.tsx` — assignee filter, system field filter, queue order
- `src/types/field.ts` — transferId on FieldWithMapping
