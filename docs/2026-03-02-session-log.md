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
