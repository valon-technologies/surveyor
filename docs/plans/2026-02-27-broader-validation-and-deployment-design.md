# Broader Validation + Deployment — Design

**Date:** 2026-02-27
**Goal:** Prove the feedback loop works across domains, then deploy for the SDT review team.

## Part 1: Broader Feedback Loop Validation

### Entities to test

| Entity | Domain | Fields | Baseline Acc | Rationale |
|--------|--------|--------|-------------|-----------|
| `loan` | core | 43 | 59.9% | Biggest entity, stress test at scale |
| `foreclosure` | foreclosure | 21 | 21.4% | Very low — can the loop rescue it? |
| `borrower` | core | 12 | 29.2% | Low accuracy, core domain |
| `escrow_analysis` | escrow | 12 | 41.7% | Mid accuracy, different domain |
| `loss_mitigation_application` | loss_mit | 6 | 33.3% | Same domain as proven entity — cross-entity learning? |
| `loss_mitigation_plan` | loss_mit | 6 | 0.0% | Worst case — zero accuracy |
| `bankruptcy_case` | bankruptcy | 19 | 81.6% | Already high — maintain/improve? |

### Process per entity

1. Batch generate with Opus (~2.5 min/entity)
2. Run SOT eval → record baseline
3. Review wrong fields in discuss view → give structured verdicts
4. Regenerate → re-eval → record improvement
5. Log before/after in a results table

### Success criteria

- Feedback loop produces measurable improvement on at least 5 of 7 entities
- At least one entity outside loss_mitigation domain improves
- Wrong-table corrections continue to apply at near 100% rate
- We have a rough reviewer-minutes-per-entity estimate

### What we learn

- Whether the loop generalizes across domains or is loss_mitigation-specific
- Whether very low accuracy entities (0%, 21%) can be improved via verdicts
- Whether corrections on loss_mitigation_loan_modification help loss_mitigation_application (cross-entity)
- How many reviewer-hours systematic review would require at scale

## Part 2: Deployment

### Target stack

- **App:** Vercel (Next.js native deployment)
- **DB:** Neon Postgres (replacing SQLite/Drizzle — Drizzle supports Postgres, migration is schema-level)
- **Auth:** Existing email/password auth, create accounts for 5 reviewers
- **Data:** Re-run import scripts against Postgres (entities, context, skills)

### Migration: SQLite → Postgres

Drizzle ORM abstracts the DB layer. Key changes:
- Switch dialect from `better-sqlite3` to `postgres-js` or `neon-serverless`
- Audit schema for SQLite-specific types (e.g. `integer` primary keys → `serial`, `text` JSON columns → `jsonb`)
- Re-run migrations against Postgres
- Re-run seed scripts (import-all-entities, seed-from-mapping-engine, generate-mapping-skills)

### Vercel deployment

- Connect GitHub repo to Vercel
- Set environment variables (ANTHROPIC_API_KEY, API_KEY_ENCRYPTION_SECRET, DATABASE_URL)
- Verify build + deploy succeeds
- Test generation → review → feedback loop on deployed instance

### User onboarding

- Create accounts for: Garrett, Stephanie, Destinee, Candice, Urmi
- Seed deployed DB with all 195 entities + 409 context docs + 54 skills
- Run batch generation on initial set of entities so reviewers have mappings to review on day 1

### Open questions

- Do we need role-based access (reviewer vs admin) or is everyone equal for now?
- Should generation be triggered from the UI or only by Rob via scripts?
- Do we need to gate the Anthropic API key cost (Opus is ~$15/M input, $75/M output)?
