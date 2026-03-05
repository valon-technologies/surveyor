# 2026-03-05 Session Log

## Summary
Analytics event capture + dashboard, M2.5 generation run, Linear data sync, smoke testing, reviewer onboarding, and production deployment.

## Analytics: Event Capture + Dashboard

**New table:** `analytics_event` — captures review lifecycle events with workspace, user, field mapping, duration, and arbitrary properties.

**Events tracked:**
- `review_started` — on discuss page mount
- `review_submitted` — with duration in ms
- `review_abandoned` — on unmount without submit
- `ai_suggestion_accepted` / `ai_suggestion_overridden` — verdict card interactions
- `why_wrong_provided` — feedback on AI errors
- `ai_chat_sent` / `ai_chat_changed_mind` — chat influence tracking

**Dashboard:** Admin > Analytics tab with:
- Review Efficiency: completion rate, median/p90 duration, daily trend chart
- AI Value: acceptance rate, chat influence, suggestion breakdown
- Quality & Learning: why-wrong rate, top reviewers
- Reviewer Breakdown: per-user table with all metrics
- Milestone + period filters

**Files created:**
- `src/lib/db/schema.ts` — `analyticsEvent` table
- `src/lib/analytics/track-event.ts` — fire-and-forget client emitter
- `src/lib/analytics/use-review-analytics.ts` — React hook for discuss page
- `src/app/api/workspaces/[workspaceId]/analytics/events/route.ts` — POST receiver
- `src/app/api/workspaces/[workspaceId]/analytics/route.ts` — GET aggregated stats
- `src/components/admin/analytics-panel.tsx` — dashboard component

## M2.5 Generation Run

**Generation results (two batch runs):**
- Run 1 (80K context budget): 27/43 entities succeeded, 10 failed (prompt too long), ~$50
- Run 2 (40K context budget): 8/9 retry entities succeeded, ~$20
- Total: 122 M2.5 fields with mapping records (26 unreviewed, 50 unmapped, 42 excluded, 4 other)
- 184 M2.5 fields still without mapping records (LLM didn't produce output for them)

**Milestone filter added to batch runner:** `BatchRunInput.milestone` restricts eligible fields and scopes `prepareEntityForRegeneration` to only retire mappings for the target milestone.

**Scripts created:**
- `scripts/generate-m25-all.ts` — full M2.5 regeneration with `--dry-run` and `--no-review` flags
- `scripts/retry-failed-m25.ts` — retry failed entities with `CONTEXT_TOKEN_BUDGET` env var
- `scripts/sync-linear-m25.ts` — sync Linear dashboard data into Surveyor

## Bug Fixes

**Unmappable fields "Direct" bug:** Output parser now forces `status: "unmapped"` and `mappingType: null` when no valid source field AND no source entity were resolved, regardless of what the LLM claimed. Fixed in both JSON and YAML parse paths.

**Provider resolver env fallback:** Falls back to `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` env vars when no encrypted keys exist in `user_api_key` table (table was empty after Postgres migration).

**Context budget override:** `getTokenBudget()` now respects `CONTEXT_TOKEN_BUDGET` env var for generation scripts.

**.env.local parsing:** Fixed regex that failed on values containing `=` (like database URLs with query params). Changed from regex to `indexOf("=")` split.

## Linear Data Sync

- Fetched all 301 M2.5-labeled issues from Linear via Gestalt GQL API
- Parsed structured data from issue descriptions (ACDC Field, Mapping Logic, Implementation Status)
- Synced 19 fields with Linear reference notes (shown as purple "Linear Reference" box in mapping summary)
- Excluded 40 Descoped/Canceled fields
- Dashboard analysis: Linear M2.5 dashboard (447) combines M2 + M2.5 labels; actual M2.5-only count is 261 active

## Entity Knowledge Backfill

- Rewrote `scripts/backfill-entity-knowledge.ts` for async Postgres
- Rebuilt 7 EK docs from validated learnings (escrow_analysis, foreclosure, loss_mitigation_plan, loss_mitigation_loan_modification, bankruptcy_case, loss_mitigation_application, borrower_coborrower)

## Review Guide Updates

- Added Quick Start checklist (5-step blue callout)
- Added "How Your Work Is Measured" section (analytics context)
- Added "Common Gotchas" section (enum nulls, assembly/SUBSET, similar table names, direct-copy defaults)
- Added "When to use the chat" guidance
- Documented Exclude button
- Updated sidebar navigation table (added Admin, Review Guide, Analytics)
- Fixed `.vercelignore` pattern that excluded `src/app/docs/` page from deployment

## UI Improvements

- **Context Used panel:** Capped at `max-h-48` with scroll overflow (was expanding unbounded)
- **Linear Reference display:** Purple box in mapping summary showing ACDC source + mapping logic from Linear
- **Other Notes textarea:** Pre-populated with existing mapping notes
- **Admin Questions tab:** Source filter (All/Reviewer/AI/Validator) with counts
- **Duplicate detection:** Changed from "Mark duplicate" to "Duplicate" (accept) + "Not dup" (reject) buttons
- **Admin page:** Route-gated to owner role only
- **Per-user analytics table:** Reviewer Breakdown section with reviews, median time, AI accept/override, why-wrong, chat, completion %

## Deployment

- Vercel production at `surveyor-pi.vercel.app`
- All env vars confirmed (ANTHROPIC_API_KEY, DATABASE_URL, AUTH_SECRET, GESTALT_API_KEY, etc.)
- `analytics_event` table pushed to Supabase via `drizzle-kit push`
- 11 reviewer invites created (editor role)

## Reference entity cleanup

- `milestone_definition` (2 fields: id, name) excluded — static reference table, not a real VDS entity

## Files Changed

| File | Change |
|------|--------|
| `.vercelignore` | Fixed `docs/` → `/docs/` to not exclude `src/app/docs/` |
| `scripts/backfill-entity-knowledge.ts` | Rewritten for async Postgres |
| `scripts/generate-m25-all.ts` | New: M2.5 full regeneration script |
| `scripts/retry-failed-m25.ts` | New: retry failed entities with reduced context |
| `scripts/sync-linear-m25.ts` | New: sync Linear data into Surveyor |
| `src/app/admin/page.tsx` | Owner role gate, questions source filter, duplicate accept/reject |
| `src/app/docs/page.tsx` | Quick start, gotchas, measurements, chat guidance |
| `src/app/mapping/discuss/[fieldMappingId]/discuss-client.tsx` | Analytics tracking, Linear ref, notes pre-populate |
| `src/components/admin/analytics-panel.tsx` | New: analytics dashboard |
| `src/components/chat/mapping-state-card.tsx` | Linear Reference purple box |
| `src/components/review/context-used-panel.tsx` | Max height constraint |
| `src/components/review/source-verdict-card.tsx` | `onWhyWrongProvided` callback |
| `src/components/review/transform-verdict-card.tsx` | `onWhyWrongProvided` callback |
| `src/lib/analytics/track-event.ts` | New: client-side event emitter |
| `src/lib/analytics/use-review-analytics.ts` | New: review session analytics hook |
| `src/lib/db/schema.ts` | `analytics_event` table |
| `src/lib/generation/batch-runner.ts` | Milestone filter, context budget env var |
| `src/lib/generation/output-parser.ts` | Force unmapped when no source resolved |
| `src/lib/generation/provider-resolver.ts` | Env var fallback, context budget override |
| `src/app/api/workspaces/[workspaceId]/analytics/events/route.ts` | New: POST event receiver |
| `src/app/api/workspaces/[workspaceId]/analytics/route.ts` | New: GET aggregated stats + per-user breakdown |
