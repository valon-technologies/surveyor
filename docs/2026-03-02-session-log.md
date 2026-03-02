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
