# Session Log — 2026-03-02

## Goal

Synthesize the past week's work across surveyor and mapping-engine. Determine what's left to deploy Surveyor to the mapping team.

---

## Week in Review (Feb 23–Mar 1)

### Surveyor (`rob/review-feedback-foundation`)

**40 commits** on the branch total, **12 unpushed** (past `origin/rob/review-feedback-foundation`).

| Date | What shipped |
|------|-------------|
| Feb 25 | Reasoning/reviewComment output fixes, local instance stood up |
| Feb 26 AM | SOT accuracy calibration, full entity+context import (195 entities, 409 context docs, 54 skills), context delivery fix (stale workspace ID) |
| Feb 26 PM | Feedback interface — 3 verdict cards (Source, Transform, Question) in discuss sidebar. Verdict → learning → EK rebuild pipeline. Vaporwave theme. Model switch to Opus. |
| Feb 26 EVE | Feedback trail — event log with correlationId threading across 5 pipeline stages. Timeline UI component. |
| Feb 27 AM | Broader validation scripts (`multi-entity-eval.ts`, `auto-verdicts.ts`). Zod null fix. Env regex fix. |
| Feb 27 PM | EK hardening — 4-layer MANDATORY phrasing (verdict notes → learning content → system prompt rule → EK section header). 3 missing source tables imported. |
| Feb 27 PM | Cycle 2 completed: 13.5% → 27.2% → 58.8% → 59.4% across 7 entities |

**Key finding: SUBSET corrections are toxic.** When the model can't satisfy "REQUIRED: Must include all of X, Y, Z" within single-source mapping format, it gives up entirely. Borrower collapsed from 41.7% → 0%. DISJOINT corrections (wrong table → right table) work reliably.

### Mapping-Engine (`main`)

**16 commits**, all pushed.

| Date | What shipped |
|------|-------------|
| Feb 23 | VDS-first refactor, Fleak decision (decline), program plan, eval methodology, Surveyor repo analysis |
| Feb 24 AM | Eval methodology validation, v3 eval reproduction |
| Feb 24 PM | Rewired map-review to YamlMapper pipeline, M2 baseline (54% MAPPED), major repo cleanup (60+ legacy dirs archived), servicing-transfer-mapping exploration |
| Feb 25 | Feedback corrections system in s-t-m (13 hard overrides + 8 prompt injections), rosetta workbook format, M2.5 dashboard fields from Linear (212 active, 132 missing), 8 new VDS skill docs, SOT repo update, Atlas retired |

### Key artifacts produced

- **AI-SDT Centralized Project Plan** (`mapping-engine/docs/ai-mapping-program-plan.md`) — 9-section canonical plan covering vision, 4 workstreams, accuracy targets, timeline
- **Eval Methodology** (`mapping-engine/docs/eval-methodology.md`) — canonical scoring methodology
- **Broader Validation Results** (`surveyor/docs/plans/2026-02-27-broader-validation-results.md`) — the proof that the feedback loop works
- **M2.5 field exports** (`mapping-engine/inputs/`) — 212 fields by status (Completed, Needs Implementation, Needs Internal Review, Needs Client Review, Change Request)

---

## Current State

### What's working

1. **Feedback loop proven across 7 entities, 4 domains.** 13.5% → 59.4% in 2 automated cycles. DISJOINT corrections near-perfect.
2. **Full generation engine** — batch generation with Opus, context assembly with skills + EK + foundational docs, YAML output parsing, SOT evaluation.
3. **Feedback UI** — verdict cards in discuss view, pipeline event trail, learning extraction, EK rebuild.
4. **CLI scripts** for batch operations — multi-entity generate+eval, auto-verdicts, give-verdicts, regenerate, persist-and-eval.
5. **409 context docs imported** — VDS skills, SM domain, mortgage domain, ACDC schemas, SOT YAMLs, transcripts, step codes.

### What's broken / incomplete

1. **SUBSET correction strategy** — causes model to give up. Borrower at 0%, escrow regressed. Need softer phrasing or multi-source mapping support.
2. **12 unpushed commits** — EK hardening + broader validation work hasn't been pushed to remote.
3. **SQLite → Postgres migration not started** — Surveyor uses `better-sqlite3`. Deployment target is Neon Postgres on Vercel. Estimated scope: schema type audit, driver swap, migration re-run, seed re-run.
4. **No Vercel deployment** — app runs locally only.
5. **No user accounts** — auth exists but only Rob's test account.
6. **Uncommitted changes** — `broader-validation-results.md` has local edits.

---

## What's Left to Deploy

### P0 — Must have for team to use

| # | Task | Est. effort | Notes |
|---|------|-------------|-------|
| 1 | **Push unpushed commits** | 5 min | 12 commits sitting local |
| 2 | **SQLite → Postgres migration** | 1-2 sessions | Swap `better-sqlite3` → `@neondatabase/serverless` or `postgres-js`. Audit schema for SQLite-isms (`integer` PKs → `serial`, text JSON → `jsonb`). Drizzle ORM abstracts most. FTS5 needs replacement (pg `tsvector` or skip for MVP). |
| 3 | **Vercel deployment** | 1 session | Connect repo, set env vars (ANTHROPIC_API_KEY, API_KEY_ENCRYPTION_SECRET, DATABASE_URL), verify build. |
| 4 | **Seed production DB** | 30 min | Re-run import scripts against Postgres: import-all-entities, seed-from-mapping-engine, generate-mapping-skills. |
| 5 | **Create reviewer accounts** | 15 min | Garrett, Stephanie, Destinee, Candice, Urmi |
| 6 | **Pre-generate mappings** | 1-2 hours | Run batch on initial entity set so reviewers have work on day 1. |
| 7 | **Fix SUBSET correction strategy** | 1 session | Rewrite SUBSET verdicts to accept primary source as correct, note secondary sources as "additional context" not MANDATORY. Without this, reviewers giving verdicts on multi-source fields will cause regressions. |

### P1 — Should have before team use

| # | Task | Notes |
|---|------|-------|
| 8 | **Investigate borrower 0-mapping regression** | Delete borrower EK, regenerate, confirm corrections caused collapse, rebuild with softer phrasing |
| 9 | **Generation trigger UX** | Currently scripts-only. Team needs at least a button in the UI, even if only Rob has access. |
| 10 | **API cost guardrails** | Opus is expensive ($15/M input, $75/M output). At minimum, rate limit or admin-only generation. |
| 11 | **Basic reviewer onboarding doc** | What to do: open entity → review discuss view → give verdicts. 1-page guide. |

### P2 — Nice to have

| # | Task | Notes |
|---|------|-------|
| 12 | **Role-based access** | Reviewer vs admin. Currently everyone is equal. |
| 13 | **Slow-loop analytics** | Confidence calibration, correction pattern extraction, question quality analysis. Per the program plan. |
| 14 | **Scale to all 92 entities** | Once aggregate accuracy stabilizes above 60% |

---

## SUBSET Correction Deep Dive (explored, deferred)

Investigated the SUBSET problem in detail. Key findings:

**54 SUBSET fields across 18 entities** — 11.4% of all scored fields. These break into 3 distinct patterns:

1. **UNION entities (16 fields)**: borrower, address, borrower_phone_number, borrower_notification_preference, notification_email_detail. The SOT has separate staging tables (e.g. `borrower_primary` + `borrower_comrtgr`) that get UNIONed. Model maps only the primary variant (e.g. MortgagorFirstName but not CoMrtgrFirstName). Needs output format change — per-component mapping rows.

2. **Multi-staging reconciliation (15 fields)**: loan_accounting_balance. SOT expects cross-reference between LoanInfo and Transaction tables (e.g. `COALESCE(Transaction.EscrowBalance, LoanInfo.EscrowBalance)`). Model picks one source. Needs multi-source transform encouragement in prompt.

3. **Multi-input derived (23 fields)**: loan, loan_at_origination_info, loan_payment_auto_pay_schedule, etc. SOT references multiple source fields for complex conditional/derived logic. Model maps the primary field only.

**Proposed full fix (8-12 hours, deferred):**
- Add `componentName` column to `fieldMapping` for per-component UNION mappings
- UNION entity detection from SOT YAMLs (22 entities use `concat` pattern)
- Prompt builder: UNION instructions + multi-source transform guidance
- Output parser: accept `component` field, allow duplicate target columns
- Auto-verdicts: component-aware for UNION, soft notes for non-UNION SUBSET
- Review UI: component grouping in discuss view
- Seed multi-source transform patterns from SOT into Entity Knowledge

**Interim approach for deployment:** Skip SUBSET corrections in auto-verdicts entirely (the model's primary-source mapping is correct, just incomplete). Delete toxic borrower EK that caused 0% collapse. Reviewers can still give manual feedback on SUBSET fields through the UI — those corrections should use soft informational phrasing, not MANDATORY. Consider building the full UNION support as a fast-follow once the team is using the tool.

See full SUBSET field list: `scripts/auto-verdicts.ts` lines 94-96 (the toxic code path).

---

## Decision: What to do this session

The critical path is: **quick SUBSET stopgap → push → Postgres migration → deploy → seed → accounts → pre-generate**.

### Recommended order

1. Quick SUBSET stopgap: skip SUBSET/OVERLAP in auto-verdicts, delete toxic borrower EK
2. Push all commits
3. SQLite → Postgres migration
4. Vercel deployment + seed + accounts
5. Pre-generate mappings for initial entity set
6. Write reviewer onboarding guide

---

## Supabase Postgres Migration Plan (ready to execute)

**Blocker:** Need Supabase project access + connection string before starting.

**Approach:** `postgres` (postgres-js) + `drizzle-orm/postgres-js` via Supabase Connection Pooler (Transaction mode, `prepare: false`). Interactive transactions fully supported.

### Scope
- 34 tables, 39 JSON columns, 11 boolean columns
- ~700 sync DB calls → async across ~119 files
- FTS5 skipped for MVP (already fails gracefully)

### Phases
1. **Dependencies** — install `postgres`, remove `better-sqlite3`, update configs
2. **Schema** — `sqliteTable` → `pgTable`, `text(json)` → `jsonb`, `integer(boolean)` → `boolean`, timestamp defaults
3. **Driver swap** — replace `db/index.ts` with postgres-js client, async `withTransaction`
4. **Sync→async conversion** (~119 files) — `.all()` → `await`, `.get()` → `[0]`, `.run()` → `await`, `withTransaction` callers
5. **Push schema** — `drizzle-kit push` to Supabase
6. **Fresh seed** — re-run import-all-entities, seed-from-mapping-engine, generate-mapping-skills
7. **Vercel deploy** — connect repo, set env vars, smoke test

### Conversion cheatsheet
| SQLite | Postgres |
|--------|----------|
| `.all()` | `await ...` (drop `.all()`) |
| `.get()` | `(await ...limit(1))[0]` |
| `.run()` | `await ...` (drop `.run()`) |
| `.returning().all()` | `await ...returning()` |
| `withTransaction(() => { ... })` | `await withTransaction(async (tx) => { ... })` |

Full plan: `docs/plans/2026-03-02-supabase-migration-plan.md` (to be committed)

---

## Next Steps (priority order)

### 1. Pre-generate AI reviews (eliminates reviewer wait time)
Currently the AI assistant takes several seconds to analyze a mapping when the reviewer opens the discuss page. Pre-generate reviews during batch generation:
- After batch generation produces mappings, run a second pass per field: AI analyzes the mapping, produces a proposed update (source/transform/question), stores in DB
- When reviewer opens discuss page, pre-generated review loads instantly from DB
- Chat stays live — reviewer can still dialogue with AI to revise the proposal
- AI session starts with the pre-generated review as context so follow-ups are coherent
- **Touches**: batch-runner.ts (add review pass), discuss-client.tsx (load pre-generated review), DB schema (store proposed updates per mapping)

### 2. Supabase migration (blocker for deployment)
See migration plan above. Need Supabase project access first.

### 3. Verify end-to-end feedback loop
1. Give a structured verdict on a foreclosure field
2. Confirm learning created → EK rebuilt → correction appears in context
3. Regenerate the entity
4. Confirm the corrected field improves

### 4. Deploy to mapping team
Push, migrate, seed, create accounts, pre-generate mappings.

### 5. Validation gates (critical before team use)
Two new pipelines needed to prevent unvalidated data from corrupting future generations:

**Question Curation Pipeline:**
- Questions start as `draft` (from reviewer or AI)
- Admin/senior reviewer dedupes against existing Q&A and checks quality
- Promotes to `approved` → only then visible to ServiceMac
- Prevents duplicate or low-quality questions from reaching the client

**Correction Validation Pipeline:**
- Reviewer verdicts (source/transform corrections) save as `pending_validation`
- Validator (senior reviewer or admin) reviews for accuracy
- Marks `validated` → THEN triggers `extractVerdictLearning` → `rebuildEntityKnowledge`
- Until validated, corrections are stored but NOT applied to future generations
- Prevents one bad verdict from cascading into all subsequent mappings

**Implementation:**
- Add `validationStatus` column to `fieldMapping` (pending_validation / validated / rejected)
- Add `curationStatus` column to `question` (draft / approved / rejected)
- Gate `extractVerdictLearning` on `validationStatus === 'validated'`
- Gate question visibility to SM on `curationStatus === 'approved'`
- Build admin validation queue UI

### 6. Client access (ServiceMac)
See client access design section above.

---

## Model Choices (documented)

| Stage | Model | Rationale |
|-------|-------|-----------|
| Initial mapping generation | Opus (`claude-opus-4-6`) | Highest quality for source identification — the binding constraint |
| AI review pass (pre-generated) | Opus (`claude-opus-4-6`) | Consistency requires Opus — Sonnet produced incoherent source/transform proposals. ~$0.15/field, ~$30 for 200 fields. |
| Live chat (discuss page) | Opus (`claude-opus-4-6`) | Highest quality for interactive dialogue with reviewer |

Code locations:
- Generation model: `src/lib/llm/providers/claude.ts:10` (`DEFAULT_MODEL`)
- Review model: `src/lib/generation/ai-review.ts` (`REVIEW_MODEL`)
- Chat model: configured in chat session API route

---

## UI Improvements Made This Session

### Layout & Navigation
- **Field sort order**: review queue and entity detail sort by confidence (high → medium → low)
- **Discuss page layout**: 3-row vertical stack — (1) current mapping, (2) AI assistant, (3) source/transform/question feedback columns
- **Prior sessions**: collapsed by default at bottom, expandable
- **Confidence labels**: "medium confidence" (not just "medium") consistently across the entire app

### Discuss Page — Current Mapping
- Condensed to single summary row: badges + source → target on left, transform wrapping on right
- No truncation anywhere — all source fields, transforms, and questions display in full

### Discuss Page — Layout (final)
1. **Current Mapping** — source/target/reasoning on left (1/3), transform on right (2/3) with SQL keyword line breaks
2. **Source | Transform | Question** — three equal columns with checkbox-based review, blue backdrop
3. **Other Notes** — full-width textarea
4. **Submit Review & Next** — status bar with per-component dots
5. **AI Assistant** — below feedback, available for follow-up dialogue
6. **Prior Sessions** — collapsed at bottom

### Discuss Page — Pre-generated AI Reviews
- New `aiReview` JSON column on `fieldMapping` stores pre-generated proposed update + review text
- AI review runs during batch generation (Opus model) — produces source/transform/question proposals
- Discuss page loads AI review **instantly** from DB — no waiting for LLM
- Live chat still available for follow-up — doesn't auto-kickoff when pre-generated review exists
- Chat can revise the proposal; new proposals override pre-generated ones
- Consistency rules in review prompt: source fields must match transform references
- Script: `scripts/generate-ai-reviews.ts` — generates reviews for specified entities
- Script: `scripts/review-single-field.ts` — re-reviews a single mapping by ID

### Discuss Page — Feedback Columns (Source | Transform | Question)
- **Checkbox-based review model** — one selection per section:
  - `[☐] current value` — with "AI Review confirms" green label when AI agrees
  - `[☐] AI Review suggestion` — shown in blue when AI proposes different value
  - `[☐] free text (specify)` — check + type to provide a different answer
- **All checkboxes unchecked by default** — reviewer must explicitly select one per section
- **Only one checkbox active per section** — selecting one deselects others (radio behavior)
- When AI agrees with current: green "AI Review confirms" label shown, but checkbox still unchecked until reviewer confirms
- When AI differs: two options shown (current vs AI Review) for reviewer to choose
- Accepting AI suggestion saves as "wrong" verdict → triggers learning extraction pipeline
- Suggestions reset when AI generates a new proposal via live chat
- No truncation/abbreviation on any values
- LLM chat prompt updated: no emojis, uses (!) for corrections and (X) for blocked items

### Discuss Page — Question Section
- QuestionFeedbackCard: "Is this question acceptable?" Yes/No with why-not dropdown and better question textarea
- CreateQuestionCard: AI suggested question with checkbox + custom question textarea + SM/VT team selector
- Question decision required before Submit Review & Next becomes clickable

### Discuss Page — Submit Review Bar
- Shows per-component decision status: Source / Transform / Question with green/gray dots
- **Requires all three** (source + transform + question) resolved before button activates
- Light blue (`bg-blue-200`) when disabled, full blue (`bg-blue-600`) when ready
- Navigates to next unreviewed field on submit
- Session complete card removed — navigation only through Submit button

### Review Queue — Progress Tracking
- **Overall progress bar** at top of review queue: "X/Y reviewed (Z%)" with colored segments (green=accepted, gray=excluded, amber=punted)
- **Per-entity progress badge**: "X/Y reviewed" — green when complete, blue when in progress, gray when not started
- Entity headers show reviewed count next to entity name

### Review Queue — Sorting
- Default sort: confidence (high → medium → low within status groups)
- Accepted/excluded fields sort to bottom

### New Files Created
- `src/lib/generation/ai-review.ts` — pre-generate AI reviews for field mappings (Opus, ~$0.15/field)
- `src/components/review/create-question-card.tsx` — question creation with AI suggestion checkbox
- `scripts/generate-ai-reviews.ts` — batch AI review generation per entity
- `scripts/review-single-field.ts` — single mapping AI review

### Files Modified (key changes)
- `src/components/chat/mapping-state-card.tsx` — split into `MappingSummary` + `ProposedUpdateCard`
- `src/lib/generation/chat-prompt-builder.ts` — added `question` field to mapping-update schema, no-emoji formatting rules, consistency rules
- `src/lib/db/schema.ts` — added `aiReview` JSON column on `fieldMapping`
- `src/app/mapping/discuss/[fieldMappingId]/discuss-client.tsx` — major refactor: vertical layout, pre-generated review loading, checkbox model, effectiveUpdate pattern
- `src/components/review/source-verdict-card.tsx` — checkbox model with AI agrees/differs logic
- `src/components/review/transform-verdict-card.tsx` — same
- `src/components/review/entity-group.tsx` — per-entity reviewed count badge
- `src/components/review/review-queue-list.tsx` — overall progress bar

---

## Client Access Design (ServiceMac and future clients)

### Concept
Allow ServiceMac staff to log into Surveyor and answer structured questions about their source system. Their answers flow into Entity Knowledge and improve mapping accuracy. Design should generalize to future clients.

### Data Isolation
- **Workspace per client** — ServiceMac gets their own workspace. Source schemas, mappings, questions, EK all scoped to workspace.
- **Shared knowledge** — mortgage domain docs, VDS skills, distilled learnings are transferable (same VDS target). Copied to each workspace, not cross-referenced.
- **EK is client-specific** — corrections reference client-specific source tables (ACDC for SM, different for future clients).

### Role Model
| Role | Who | Can do | Cannot do |
|------|-----|--------|-----------|
| admin | Valon eng | Everything, cross-workspace | — |
| reviewer | Valon mapping team | Review, verdicts, manage EK | Other client workspaces |
| client | ServiceMac staff | Answer questions, provide domain context | See EK, SOT scores, internal reasoning, other clients |

### What Clients See vs. Don't See
**Show:** Questions tagged for them, their source schema, mapping proposals needing input.
**Hide:** EK corrections, SOT eval scores, Valon verdicts/notes, LLM chat (leaks internal context), confidence calibration, other clients.

### Client Question Workflow
1. Valon reviewer (or auto-gen) creates question → `targetForTeam: "SM"`
2. SM user logs in, sees question queue
3. Answers in plain English
4. Answer → EK → next generation improves
5. Valon reviewer validates

### Security Risks
1. LLM chat prompt includes EK/SOT — must hide from clients or build client-safe prompt
2. `withAuth` checks workspace but not role — need role-based route guards
3. Client answers enter EK → LLM prompts — sanitize for prompt injection
4. Audit all routes for cross-workspace leakage

### Build Order (ServiceMac-first, then generalize)
1. Role-based route guards — extend `withAuth` to check role
2. Client question view — simplified page for SM questions only
3. Hide internal data — strip EK/verdicts/SOT from client API responses
4. Workspace provisioning for new clients
5. Client invite flow with role assignment

### Can we build this on the current instance?
Yes — the existing workspace/role infrastructure supports it. The `userWorkspace` table has `role` and `team` fields. The `question` table has `targetForTeam`. The main work is:
- Add a `"client"` role option
- Build role-based API guards (extend `withAuth`)
- Create a client-facing question view (stripped-down page)
- Create SM user accounts with `role: "client"`

This can be done incrementally — start with the question view for SM, then add isolation as we prepare for additional clients.

---

---

## Validation Gates (built this session)

### Correction Validation Pipeline
- Reviewer verdicts create learnings with `validationStatus: "pending"`
- `rebuildEntityKnowledge` only includes `"validated"` learnings
- `extractVerdictLearning` no longer auto-rebuilds EK
- Admin validates/rejects at `/admin` → Corrections tab → then EK rebuilds
- Schema: `validation_status`, `validated_by`, `validated_at` on `learning` table

### Question Curation Pipeline
- Questions created during review start as `curationStatus: "pending_review"` (invisible)
- When reviewer clicks Submit Review & Next → promoted to `"draft"` (visible in admin queue)
- Admin approves/rejects/marks-duplicate at `/admin` → Questions tab
- Only `"approved"` questions visible to SM/client views
- Schema: `curation_status`, `curated_by`, `curated_at`, `duplicate_of` on `question` table
- Dedup: admin sees similar approved questions when reviewing drafts

### Additional fixes in this batch
- Submit Review marks mapping as `accepted` status
- Source name→ID resolution in PATCH mapping route (AI proposals now persist correctly)
- Pre-generated AI review injected into live chat context for continuity
- Checkbox toggle (uncheck) working for source/transform
- Transform shows "none" for unmapped fields instead of "direct"
- Batch generation panel hidden from mapping page (admin-only TODO)

---

## Cumulative Branch Changes

**Branch:** `rob/review-feedback-foundation` — 40 commits ahead of base
**Stats:** 427 files changed, 69,230 insertions, 2,824 deletions

### What this branch adds to Surveyor (cumulative)

| Feature | Status |
|---------|--------|
| SOT accuracy calibration (eval vs ground truth) | Complete |
| Full entity + context import (195 entities, 409 docs, 54 skills) | Complete |
| Context delivery fix (workspace ID, skill matching, EK) | Complete |
| Feedback interface (source/transform/question verdict cards) | Complete |
| Feedback trail (pipeline event log with correlationId) | Complete |
| Broader validation (7 entities, 13.5% → 59.4%) | Complete |
| EK hardening (4-layer MANDATORY phrasing) | Complete |
| SUBSET stopgap (skip toxic corrections) | Complete |
| Pre-generated AI reviews (instant discuss page load) | Complete |
| Checkbox-based review model (current/AI/specify) | Complete |
| Review progress tracking (overall + per-entity) | Complete |
| Validation gates (correction + question curation) | Complete |
| Admin page (validate corrections, curate questions) | Complete |
| Supabase migration | **Not started** — needs project access |
| Vercel deployment | **Not started** — blocked by migration |
| Client access (ServiceMac portal) | **Designed, not built** |
| UNION entity support (multi-source) | **Designed, deferred** |

---

## What's Left Before Users Can Review

### P0 — Must fix/test before handing to reviewers

1. **End-to-end correction flow test** — submit a correction → admin validates → EK rebuilds → regenerate → verify model uses correction. We tested pieces but not the full admin-gated loop.
2. **Supabase migration** — app runs on SQLite locally. Team needs hosted DB. ~5-7 hours focused work (schema swap 1hr, driver 15min, sync→async codemod 2-3hrs, transactions 30min, seed scripts 1hr, test/fix 1-2hrs). Most is mechanical find-and-replace.
3. **Vercel deployment** — connect repo, env vars, build. Blocked by Supabase.
4. **Seed production DB** — re-run import scripts against Supabase.
5. **Create user accounts** — 5 reviewers + 1 admin.
6. **Pre-generate mappings + AI reviews** — batch run on target entities so reviewers have work on day 1.

### P1 — Should have for good experience

7. **Batch generation on admin-only page** — currently hidden, needs proper page.
8. **Review onboarding guide** — 1-page doc for reviewers.
9. **API cost guardrails** — rate limiting or admin-only generation triggers.

### P2 — After initial deployment

10. **Client access (ServiceMac)** — question portal for SM team.
11. **UNION entity support** — multi-source mapping format.
12. **Slow-loop analytics** — confidence calibration, correction pattern extraction.
13. **Full SUBSET correction strategy** — 8-12 hours, deferred.

---

## 2026-03-03 Session Additions

### Context Traceability (implemented)

Full 6-phase implementation: citations, inline viewer, audit trail.

1. **Persist context usage per generation** — `promptSnapshot.contextUsed` stores `{id, name, tokens}` for every context doc assembled. `mappingContext` junction table batch-populated after `saveMappingsAndQuestions()`.
2. **AI review context tracking** — `ReviewResult.contextUsed` tracks Entity Knowledge + linked mapping contexts consulted during review.
3. **Citation markers in prompts** — `[ref:ctx_ID]` tags on every context doc header in prompt-builder, chat-prompt-builder, and ai-review prompts. Citation instruction added to system prompts.
4. **Parse citations in UI** — `CitationMarkdown` component splits text around `[ref:ctx_ID]` markers, renders as clickable `ContextLink` components with expandable inline preview.
5. **Inline context panel** — `ContextUsedPanel` in discuss page below mapping summary. Shows all context docs grouped by type, expandable with content preview + link to context library.
6. **Deep links** — `/context?id=X` auto-navigates context library tree, switches category if needed.

Commit: `7362a97` — 16 files, +593 lines. Pushed.

### Data Preview rename

Atlas renamed to "Data Preview" in sidebar label and top bar. Internal route still `/atlas`. Icon changed from Globe to Database.

### SUBSET cleanup (executed)

Ran `scripts/delete-toxic-ek.ts` — deleted 7 toxic borrower learnings containing SUBSET corrections ("Expected sources: X, Y") that caused borrower to collapse from 41.7% → 0%. Auto-verdicts skip was already committed (`bb3e0cc`).

### Analytics repo discovery

Found production M2 mappings in `analytics/analytics/platform/sdt_mapping/m2_mappings/` — **202 M2 YAMLs** in the same format as M1. Currently Surveyor only evaluates against M1 ground truth. Importing M2 SOT would close the "no automated accuracy for M2" gap.

Also found:
- `sdt_mapping_config.yaml` — production dependency graph with exact parent-child relationships
- `staging:` references in YAMLs definitively mark assembly vs flat entities
- Expression patterns (`np.select`, `.map()`, `date_add()`) document what `to_vds_polars.py` supports — could tighten YAML validation

### Planned improvements from analytics repo

| # | Task | Effort | Impact |
|---|------|--------|--------|
| 1 | Import M2 SOT YAMLs into Surveyor evaluation | ~1 session | Enables automated accuracy measurement for 202 M2 fields (currently zero) |
| 2 | Validate generated YAMLs against production expression patterns | ~half session | Reject expressions that would fail at runtime in to_vds_polars.py |
| 3 | Import production dependency graph from sdt_mapping_config.yaml | ~1 hour | Replace/validate Surveyor's computed graph with production truth |
| 4 | Seed structure classification from production staging references | ~1 hour | Definitively mark assembly vs flat from M2 YAMLs |

### M2 SOT integration plan (designed, deferred)

Full plan written at `.claude/plans/ancient-toasting-pond.md`. Approach: build a YAML SOT parser directly in `sot-loader.ts` that reads raw mapping YAMLs (no mapping-engine dependency). Key logic:
- Build alias→table map from `sources:` section (pipe_file only, skip staging)
- For identity: resolve `source: alias.Field` → `Table.Field`
- For expression: regex extract `alias.Field` patterns, resolve against alias map, filter to known aliases only (excludes `np`, `pd`)
- For hash_id/null/literal: skip
- `loadSotForEntity()` checks eval JSON dir first (M1), then M2 YAML dir as fallback
- `listAvailableSotEntities()` merges both dirs, deduplicated
- Env var `SOT_M2_YAML_DIR` points to sdt_mapping/acdc_to_vds/m2_mappings
- No changes needed to mapping-evaluator, source-matcher, evaluation UI, or DB schema

Source paths confirmed:
- M1 SOT: 196 YAMLs at `sdt_mapping/acdc_to_vds/m1_mappings/`
- M2 SOT: 201 YAMLs at `sdt_mapping/acdc_to_vds/m2_mappings/`
- Also available in analytics repo: `analytics/platform/sdt_mapping/m{1,2}_mappings/` (196 + 202)

### End-to-end pipeline integration (SDT mapping + SDT tracing skills)

The analytics repo has two Claude skills that together describe the full data pipeline: `sdt-mapping` (ACDC → VDS YAML transforms) and `sdt-tracing` (VDS intake → onboarding → cellar write). Surveyor covers the middle piece. Combining both opens four new capabilities:

**1. Runtime validation via pre_cellar_vds (Phase 3+)**
`raw_acdc_m1.pre_cellar_vds` in BigQuery contains the actual VDS intake output in EAV format (entity_type, entity_id, field_name, field_value). Surveyor could query this table and compare mapped values against actual output — not just "did we match the SOT spec" but "does the data actually arrive correctly." This is a stronger signal than SOT evaluation.

**2. Onboarding coverage gaps (Phase 3)**
The tracing skill documents that each VDS entity needs an onboarding task config in front-porch (`vds_*_onboarding_task_config.py`) to actually reach cellar. A mapped field with no task config is dead. Surveyor could surface: "this entity has 40 mapped fields but no onboarding config exists." Changes review priority — no point perfecting mappings for entities that can't onboard.

**3. Discrepancy tracing (Phase 4+)**
When a cellar value is wrong, trace each layer: ACDC source → pre_cellar_vds → cellar. If wrong in pre_cellar_vds, it's a mapping bug (Surveyor fixes this). If correct in pre_cellar_vds but wrong in cellar, it's an onboarding bug (front-porch). A "trace discrepancy" feature could take loan_number + field, query BigQuery at each layer, show where the value diverged.

**4. Expression validation against production runtime (Phase 3)**
`to_vds_polars.py` executes the YAML expressions. Surveyor could validate that generated expressions are actually runnable — not just syntactically valid YAML, but expressions the engine can execute. Check pre_cellar_vds output to verify correctness.

Key BigQuery tables:
- `raw_acdc_m1.{Table}` — raw ACDC source (Layer 1)
- `raw_acdc_m1.pre_cellar_vds` — SDT mapping output in EAV format (Layer 2)
- `raw_mysql_cellar.{table}` — final persisted state (Layer 3)
- Idempotency tokens: `ACDC_*` (old converter) or `VDS_*` (current pipeline)

front-porch paths:
- Task configs: `front_porch/modules/{domain}/internals/vds_*_onboarding_task_config.py`
- Domain services: `front_porch/modules/{domain}/**/*_service.py`
- Task type enum: `front_porch/modules/data_dict/loan_onboarding_task_types.py`

### VDS field milestone source of truth (blocker for accurate dashboard)

The dashboard shows milestone progress bars (M1/M2/M3/M4) but the underlying field→milestone assignments are unreliable. Specific issues:

1. **M2.5 doesn't exist as a clean category** — some fields tagged "M2 - SDT" in the VDS schema spreadsheet were originally M2.5, which was later folded into M2. It's unclear which fields are "real M2" vs "M2.5 folded in."
2. **M3 field list not confirmed** — `inputs/m3_input.xlsx` in mapping-engine has 137 fields, but this may be stale. Need a definitive source.
3. **No single canonical field→milestone mapping** — the `field.milestone` column in Surveyor's DB was populated from the VDS schema CSV during import, but that CSV's milestone column has inconsistencies (some fields tagged "M1 - SDT", others just "M1", some blank).
4. **Dashboard numbers depend on this** — the milestone progress bars, entity progress table, and coverage stats all filter by `field.milestone`. Garbage in, garbage out.

Need: a definitive, human-reviewed field→milestone mapping that we can import into Surveyor. Could be a curated spreadsheet, a canonical CSV in the repo, or pulled from Linear (where the SDT team tracks field status). Until this exists, milestone-level dashboard numbers should be treated as approximate.

### SOT mapping viewer + IO config visibility (planned)

Reviewers need to see the existing production SOT mapping for an entity alongside Surveyor's generated mapping — "what does production currently do for this field?" Currently SOT data is only used for accuracy scoring (a number), not displayed as a reference. Two needs:

1. **SOT mapping viewer** — show the production YAML mapping for each field in the discuss page or a dedicated view. Source table, source field, transform expression, and any filters. Lets reviewers see what was already implemented and decide whether to match it or improve on it.

2. **IO config visibility** — show whether a VDS entity has an onboarding task config in front-porch (from the sdt-tracing skill). Which fields from the mapping actually get consumed by the onboarding pipeline? Which are dead (mapped but never onboarded)? This changes review priority and helps the team focus on fields that matter for production.

### SOT Mappings page (implemented)

New sidebar section at `/sot-mappings` — dedicated page for browsing production YAML mappings.

- **YAML parser** (`src/lib/sot/yaml-parser.ts`): reads 389 production YAMLs (192 M1 + 197 M2), resolves alias→Table.Field references, extracts sources from expressions
- **Onboarding config** (`src/data/onboarding-task-configs.json`): 147 entities across 68 task types, extracted from front-porch VDS task configs
- **Two-panel UI**: entity list grouped by M1/M2 with search + onboarding badges (left), mapping detail with sources/joins/field table/raw YAML (right)
- **Field table**: expandable rows showing full expression text, transform type badges (green=identity, amber=expression, blue=hash_id, gray=null), staging source indicators
- **API routes**: list + detail endpoints reading YAMLs from filesystem via `SOT_MAPPING_DIR` env var

Commit: `915fdbd` — 17 files, +2,283 lines. Pushed.

### Reviewer onboarding guide (implemented)

In-app guide at `/docs`, accessible as "Review Guide" (top item in sidebar nav). Covers:
- The review flow (entity → field → discuss → submit)
- Each discuss page section with verdict options
- How corrections feed back into the AI
- Tips (check SOT, use citations, be specific)
- Sidebar navigation reference

Commits: `6b80526` + `0dc08c4`. Pushed.

### Duplicate learning idempotency (fixed)

Both `extractVerdictLearning` and `extractMappingLearning` now check for existing learning with same `(workspaceId, entityId, fieldName, content)` before inserting. Multiple clicks on same verdict no longer create duplicate records.

### Production dependency graph (imported)

New script `scripts/import-dependency-graph.ts` reads `sdt_mapping_config.yaml` from analytics repo. Produces `src/lib/generation/production-dependencies.json` (212 entities, 437 dependency edges). `dependency-graph.ts` now uses production ordering first, heuristic `*_id` fallback for entities not in the config. Batch runner logs which strategy was used (`production` / `heuristic` / `mixed`).

### Structure classification seed (script ready)

New script `scripts/seed-structure-classification.ts` reads M2 YAMLs and classifies entities:
- Has `concat:` key → assembly parent
- Has `staging:` sources → assembly component
- All `pipe_file:` → flat (single_source or multi_source_same_type)

Seeds `entity_scaffold` table so batch runner skips LLM-based classification for known entities. Run: `npx tsx scripts/seed-structure-classification.ts`

Commit for all three: `a639428` — 7 files, +1,608 lines. Pushed.

### Notion plan updated

- Updated date, "What's Built" table (4 new rows), Phase 1 status
- Added flowchart section (Mermaid diagrams matching feedback loop style)
- Restructured roadmap into 5 phases (Deploy → Quality → Scale → Client → Multi-Source)
- Added App Navigation Guide (all 10+ sidebar items)
- Added "How Reviewer Feedback Is Stored and Processed" with step-by-step DB examples
- Added "Analytics Repo Integration" section (M2 SOT, expression validation, dep graph, structure classification)
- Added "End-to-End Pipeline Integration" section (runtime validation, onboarding gaps, discrepancy tracing)
- Added "SOT Mapping Viewer + IO Config Visibility" (now implemented)
- Added "VDS Field Milestone Source of Truth" blocker
- Added "M2 SOT Integration" (planned, plan written)

### Cumulative 2026-03-03 commits

```
7362a97 feat: context traceability, citations, and SUBSET cleanup
915fdbd feat: SOT Mappings page — browse production YAML mappings with IO config visibility
6b80526 feat: add reviewer onboarding guide at /docs
0dc08c4 move Review Guide to top of sidebar nav
a639428 fix: learning dedup + production dependency graph + structure classification
```

5 commits, ~4,700 lines added across 42 files.

### SOT as generation context (implemented)

Generation prompts now include production YAML mappings as context:
- **Same-entity SOT**: if a production YAML exists for the target entity (prefer M2, fallback M1), full YAML included
- **Cross-entity SOT**: up to 2 related entities from same domain via name-prefix matching, sorted by field count
- New `findRelatedSotEntities()` in yaml-parser.ts for domain-sibling lookup
- Capped at 8K tokens, drops cross-entity first if over budget
- System prompt: "learn patterns, don't blindly copy; Entity Knowledge corrections take precedence"
- Placed between source schema and context docs in prompt

Commit: `07c5acd`. Pushed.

### Admin generation tab + cost guardrails + YAML expression validation (implemented)

Three features in one commit:
1. **Admin generation tab**: "Generation" tab added to `/admin` page with BatchRunPanel
2. **Cost guardrails**: daily token budget check (default 2M tokens/day, configurable via `DAILY_TOKEN_BUDGET`). HTTP 429 when exceeded. Applied to both batch runs and single generations.
3. **YAML expression validation**: detects SQL/BigQuery syntax in generated expressions (CAST, CASE WHEN, COALESCE, PARSE_DATE, IF, SAFE_CAST). Flags as warnings with pandas equivalents suggested. Integrated into existing yaml-validator.ts validation pipeline.

Commit: `edc5560`. Pushed.

### SOT Mappings staging improvements (implemented)

- **Staging component nesting**: assembly parents show expandable list of their staging components. 70 components hidden from top-level list (~127 shown per milestone instead of ~197)
- **Reliable staging detection**: two-pass approach resolves YAML `table:` field → filename mismatches (e.g., `borrower_comortgr` vs `borrower_comrtgr`)
- **ACDC source resolution**: assembly entities show "Staging Components (ACDC Sources)" section with each component expandable to show field mappings traced to actual ACDC tables
- **Field Mappings moved above Sources & Joins** in detail view

Commits: `915fdbd`, `b2437e7`, `9b344ac`, `3351368`. Pushed.

### Sidebar consolidation (implemented)

Sidebar reduced from 12 items to 5 top-level with 3 expandable groups:

```
▼ Mapping
    Progress Summary
    Human Review UI
    Questions from Human Review
    Review Guide
▼ Context
    Library
    Skills
▼ Data
    Schemas
    Preview
    Topology
Verified Mappings
Admin
```

Expandable groups use NavItemRenderer with children array, auto-expand when current path matches. Tab state via URL params for sidebar-driven navigation. Old routes preserved for backward compatibility.

Commits: `53a290f`, `b923cea`, `4b49cac`, `0d11c8e`, `3cfb10e`, `8090268`, `67b3db8`, `cc1935c`, `03ddd4c`, `124ffa7`, `4d9c05e`, `7b3df15`. Pushed.

### Cumulative 2026-03-03 session totals

~25 commits, ~10,000+ lines added across 80+ files.

### Chat answer → question promotion (implemented)

AI assistant messages in the discuss page chat now show "Use as answer to: '...'" link when an open question exists for the current field. Clicking it calls the existing resolve API with the message content, triggering all side effects (learning record, cascade resolution, AI evaluation). Added to the Review Guide tips.

Commit: `7415720`. Pushed.

### Sidebar consolidation — final state

After multiple iterations, sidebar reduced to 5 top-level items with 3 expandable groups:

```
▼ Mapping
    Progress Summary
    Human Review UI
    Questions from Human Review
    Review Guide
▼ Context
    Library
    Skills
▼ Data
    Schemas
    Preview
    Topology
Verified Mappings
Admin
```

NavItemRenderer component supports expandable groups with children array, auto-expand when current path matches, and child active state detection (handles same-path children, tab params, and different-route children).

### Final session totals (2026-03-03)

~30 commits across the session. Major features:
1. Context traceability (citations, inline viewer, deep links) — 6 phases
2. SOT Mappings page with IO config visibility + staging nesting + ACDC source resolution
3. M2 SOT integration (201 entities, up from 92)
4. SOT as generation context (same-entity + cross-entity domain siblings)
5. Admin generation tab + cost guardrails + YAML expression validation
6. Production dependency graph import (212 entities, 437 edges)
7. Structure classification seed script
8. Duplicate learning idempotency fix
9. Chat answer → question promotion
10. Reviewer onboarding guide
11. Sidebar consolidation (12 items → 5 top-level, 3 expandable groups)
12. Data Preview rename (Atlas → Data Preview)
13. SUBSET toxic learnings cleanup
14. Notion plan overhaul (roadmap, flowcharts, nav guide, feedback tables, analytics integration, pipeline integration, milestone SOT blocker)

### All code work items complete

| # | Task | Status |
|---|------|--------|
| 7 | M2 SOT integration | Done |
| 8 | Duplicate learning fix | Done |
| 9 | Production dependency graph | Done |
| 10 | Structure classification seed | Done |
| 11 | YAML expression validation | Done |
| 12 | Admin generation page | Done |
| 13 | API cost guardrails | Done |
| 14 | Chat answer → question promotion | Done |

### Rich IO config for SOT Mappings (implemented)

Replaced generic task type badges with actionable onboarding detail:
- **Task roles**: "Primary entity" vs "Dependency" — tells reviewer whether this entity is the main target or just referenced
- **Consumed fields**: extracted from front-porch `.onboard()` methods (65/71 tasks have field-level data). Cross-referenced against entity's actual field mappings.
- **Expandable per-task**: click to see fields consumed from this entity (green checkmarks) vs fields from other entities in the same task (muted)
- Entities without onboarding show amber "No onboarding config" warning

Also: Notion plan updated — marked analytics items as DONE, updated Phase 2 roadmap, rewrote App Navigation Guide for new sidebar structure, added What's Built rows.

Commits: `03ed962` (prominent IO config), `a8e35cb` (rich IO config with roles + fields). Pushed.

### Remaining (external blockers)

| Task | Blocker |
|------|---------|
| Supabase migration | Need project access + connection string |
| Vercel deployment | Blocked by Supabase |
| VDS field milestone SOT | Need team to confirm M2/M2.5/M3 assignments |
| End-to-end correction flow test | Need hosted instance |

---

## Git History Reference

### Surveyor — unpushed commits (12)
```
9f8b427 add MANDATORY preamble to Entity Knowledge corrections section
491d757 add ENTITY KNOWLEDGE RULE to both system prompts
09301b3 harden verdict learning content with CORRECTION (MANDATORY) phrasing
c000869 harden auto-verdict note templates with REQUIRED/verified phrasing
b3a21af docs: add session log to validation results
77dc3ac docs: record broader validation results (7 entities, 13.5% → 27.2%)
f685488 fix: allow null values in enumMapping records
143ed02 fix: env loading regex for \r line endings in scripts
22e5fcd feat: add auto-verdicts script using SOT as ground truth
569fbfa feat: add multi-entity generate + eval script
74f5a6b docs: add broader validation implementation plan
0e57c0e docs: add broader validation + deployment design
```

### Mapping-Engine — all pushed to main
```
b2dfb80 Update session log: retire Atlas, add reviewer feedback + mining design
b38fef2 Add session log for 2026-02-25
8d4564b Add 8 missing M2.5 entity skill docs
dd7899c Refactor review workbook to rosetta format, add M2.5 dashboard field exports
bef64f8 → af1f0a4 (Feb 24): map-review rewire, repo cleanup, M2 baseline, eval methodology
```
