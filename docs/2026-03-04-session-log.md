# Session Log — 2026-03-04

## Reviewer Feedback UI Enhancements

**"Why was the AI wrong?" explanation boxes:**
- Added `whyWrong` textarea to `source-verdict-card.tsx` and `transform-verdict-card.tsx`
- Appears when reviewer selects AI Suggestion or Custom (i.e., disagrees with current mapping)
- Explanation saved alongside correction in verdict notes: `\nWhy AI was wrong: ...`
- Amber-styled box with contextual placeholder text

**Learning pipeline fix:**
- `mapping-learning.ts`: Added handling for generic `"wrong"` verdict from discuss page (previously only handled specific verdicts like `wrong_table`, `wrong_field` — the discuss page's "wrong" was silently dropped)
- Now creates `CORRECTION (MANDATORY)` learning from discuss page corrections

**Review Guide (`docs/page.tsx`) updated:**
- Rewrote Source/Transform/Question section to describe actual three-choice UI (Current, AI Suggestion, Custom)
- Documented "Why was the AI wrong?" boxes and how they feed the learning pipeline
- Added milestone filter tip, updated sidebar nav table
- Reworded feedback loop section to emphasize value of "why" explanations

## User Profiles, Leaderboard & Domain Expertise

**Stats API** — `GET /api/workspaces/[workspaceId]/members/[userId]/stats`
- Total fields reviewed, questions answered, chat sessions
- Per-domain breakdown with acceptance rate (% of mappings not overwritten by another reviewer)
- Strength badges for top domains (>80% acceptance, >5 fields reviewed)
- Rank among all editors in workspace
- Access control: self or admin (owner) only

**Profile stats dashboard** — added to `src/app/settings/page.tsx`
- Total reviewed + questions answered + rank
- Domain breakdown table with colored dots, review count, acceptance %
- Green/amber/red coloring on acceptance rate
- Star badges on strength domains

**Domain Leaders** — new `src/components/dashboard/domain-leaders.tsx`
- Card on dashboard overview showing top 3 reviewers per domain
- Domain-colored dots, compact `Name (count) · Name (count)` layout
- Data from new `domainLeaders` field on dashboard API response

**Admin nav gating** — `src/components/layout/sidebar-nav.tsx`
- Added `requiredRole` field to NavItem interface
- Admin sidebar link now only renders for `owner` role users
- API routes were already gated — this just hides the UI

## SQLite → Supabase Postgres Migration

### Phase 1: Schema Conversion
- `src/lib/db/schema.ts` (1295 lines, 35 tables):
  - `sqliteTable` → `pgTable` (35 occurrences)
  - `integer("...", { mode: "boolean" })` → `boolean("...")` (11 columns)
  - `text("...", { mode: "json" })` → `jsonb("...")` (40 columns)
  - `strftime(...)` → `to_char(now() at time zone 'utc', ...)`
- `drizzle.config.ts`: `dialect: "sqlite"` → `"postgresql"`, `DATABASE_URL`
- `next.config.ts`: removed `better-sqlite3` from `serverExternalPackages`
- Installed `postgres` package

### Phase 2: Connection Swap
- `src/lib/db/index.ts`: replaced `better-sqlite3` singleton with `postgres-js` driver
- Singleton pattern with `globalThis` for dev mode connection reuse
- `prepare: false` for Supabase PgBouncer compatibility
- `withTransaction` changed from sync to async: `(fn: () => T) → (fn: (tx) => Promise<T>)`
- Removed `getSqliteDb()` export

### Phase 3: Async Refactor (~750 DB call sites)
- Wrote 4 codemod scripts to handle bulk conversion:
  - v1: `.all()` → remove + await, `.get()` → `[0]` + await, `.run()` → remove + await
  - v2: Handle multiline chains, add await to `db.` operations
  - v3: Make functions containing `await` into `async`, fix multiline `= db\n .select()`
  - Fix scripts: remove misplaced `async` keywords, fix `.mapasync` artifacts
- Dispatched 3 parallel agents to fix remaining issues:
  - Agent 1: 14 API route files — `.map()` callbacks with await → `await Promise.all(.map(async ...))`
  - Agent 2: 25 lib files — same pattern + `withTransaction` fixes + cascading async
  - Agent 3: Final 421 errors — `[0]` on un-awaited queries, missing `await` on async functions
- **Result: 0 TypeScript errors** (down from 944 → 664 → 421 → 33 → 4 → 0)

### Phase 4: FTS5 → Postgres Full-Text Search
- Rewrote `src/lib/rag/fts5-search.ts`: removed `getSqliteDb()`, uses `plainto_tsquery` + `ts_rank`
- Function now async, uses Drizzle `sql` template for tsvector queries

### Phase 5: Storage Routes
- `storage/route.ts`: replaced `dbstat` with `pg_total_relation_size` + `pg_database_size`
- `storage/prune/route.ts`: replaced raw SQLite SQL with Drizzle queries, removed VACUUM

### Phase 6: Supabase Setup
- Supabase project created via Vercel Marketplace: `ygpxxczonnwcmbynleog` (us-west-2)
- Schema pushed via `drizzle-kit push` — 34 tables created
- `.env.local` updated with `DATABASE_URL` (pooled, port 6543) and `DATABASE_URL_DIRECT` (port 5432)

### Phase 7: Data Migration (partial)
- Wrote `scripts/migrate-all-to-supabase.ts` covering all tables
- **Successfully migrated**: user (1), workspace (2), user_workspace (2), schema_asset (5), entity (266), field (6,182), context (417), skill (54), skill_context (521), generation (223), batch_run (18), field_mapping (3,208)
- **Partially migrated**: mapping_context (~7k of 27,818)
- **Not started**: chat_session (201), chat_message (523), question (773), learning (78), entity_pipeline (76), feedback_event (511), activity (24)
- **Stopped**: row-by-row inserts too slow over network (~50 rows/sec). Need bulk COPY approach tomorrow.

## Files Created
| File | Purpose |
|------|---------|
| `src/app/api/workspaces/[workspaceId]/members/[userId]/stats/route.ts` | User stats API |
| `src/components/dashboard/domain-leaders.tsx` | Domain leaders dashboard card |
| `docs/plans/2026-03-04-user-profiles-leaderboard-design.md` | Design doc |
| `scripts/migrate-all-to-supabase.ts` | Full data migration script |
| `scripts/codemod-async-db.ts` | Codemod v1 |
| `scripts/codemod-async-db-v2.ts` | Codemod v2 |
| `scripts/codemod-async-db-v3.ts` | Codemod v3 |
| `scripts/fix-misplaced-async.ts` | Fix misplaced async keywords |
| `scripts/fix-final-syntax.ts` | Fix withTransaction + method name artifacts |
| `scripts/fix-method-async.ts` | Fix .mapasync patterns |
| `scripts/fix-await-async.ts` | Fix await-in-non-async functions |

## Files Modified (key changes only)
| File | Change |
|------|--------|
| `src/lib/db/schema.ts` | SQLite → Postgres types (35 tables) |
| `src/lib/db/index.ts` | better-sqlite3 → postgres-js |
| `src/lib/db/copy-on-write.ts` | Sync → async transactions |
| `src/lib/rag/fts5-search.ts` | FTS5 → Postgres tsvector |
| `src/components/review/source-verdict-card.tsx` | Added whyWrong textarea |
| `src/components/review/transform-verdict-card.tsx` | Added whyWrong textarea |
| `src/lib/generation/mapping-learning.ts` | Generic "wrong" verdict handling |
| `src/app/settings/page.tsx` | Added stats dashboard section |
| `src/app/api/workspaces/.../dashboard/route.ts` | Added domainLeaders |
| `src/types/dashboard.ts` | Added DomainLeaderEntry type |
| `src/components/layout/sidebar-nav.tsx` | Admin nav gating by role |
| `src/app/docs/page.tsx` | Review Guide rewrite |
| `drizzle.config.ts` | sqlite → postgresql dialect |
| `next.config.ts` | Removed better-sqlite3 |
| ~128 files in `src/app/api/` and `src/lib/` | Async DB call migration |

## Tomorrow
1. Finish data migration with bulk COPY (mapping_context + remaining tables)
2. Restart dev server against Supabase, smoke test
3. Rotate Supabase password (exposed in chat)
4. Vercel deploy: set env vars, build, deploy preview
5. SOT files → DB tables (for full Vercel compatibility)
