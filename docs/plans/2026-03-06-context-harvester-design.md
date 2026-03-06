# Context Harvester Design

**Date**: 2026-03-06
**Goal**: One-off harvest of mapping decisions and rationale from Slack, Linear, and Google Sheets into Surveyor's context system, anchored against validated SOT mappings.

## Problem

Surveyor generates field mappings using LLM + existing context (ServiceMac schemas, entity knowledge, foundational docs). But the richest source of mapping rationale — *why* a field maps a certain way — lives scattered across Slack threads, Linear comments, and Google Sheets. This institutional knowledge isn't available during generation.

## Approach: Truth-Anchored Knowledge Graph

Use validated M1/M2 SOT YAML mappings as truth anchors. Mine external sources for claims about field mappings. Classify each claim by its relationship to the truth anchor (agrees, contradicts, or related). Load surviving claims into Surveyor as a new context subcategory.

## Sources

| Source | Scope | Milestone | Truth Anchor |
|--------|-------|-----------|-------------|
| Slack | #proj-ocean-acdc-transform, #systems-data-transfer, #proj-m1-dry-runs | M1 | M1 SOT YAML |
| Google Sheet (M1 tracker) | Tab "M1 tracker", Col F (In M1 Population) != NO | M1 | M1 SOT YAML |
| Google Sheet (M2 tracker) | Tab "M2 tracker", Col D = YES | M2 | M2 SOT YAML |
| Linear | MAP team project (M2 + M2.5 issues + comments) | M2/M2.5 | M2 SOT YAML |

**Sheet ID**: `1c6FlGBbNEdEOGsWvnwYiAmRtm6Mr2lLnWZ7oCmynrXY`

## Data Model

### Claim

An atomic statement about a field mapping extracted from an external source.

```typescript
interface HarvestedClaim {
  id: string;
  source: "slack" | "linear" | "google_sheet";
  sourceRef: string;             // channel+ts, issue ID, cell ref
  milestone: "M1" | "M2" | "M2.5";
  entityName: string | null;     // resolved VDS entity
  fieldName: string | null;      // resolved VDS field
  claimText: string;             // normalized statement
  claimType: "mapping_logic" | "transformation_rule" | "business_rule" | "rationale" | "question_answer";
  anchorStatus: "agrees" | "contradicts" | "related" | "unanchored";
  anchorDetail: string | null;   // explanation of why it agrees/contradicts
  confidence: number;            // 0-1, based on anchor status + source quality
  rawContent: string;            // original text for provenance
  createdAt: string;
}
```

### Anchor Resolution

For each claim with a resolved entity+field, look up the SOT YAML:

- **agrees**: claim describes the same source table, column, or transformation as the YAML
- **contradicts**: claim conflicts with the YAML (different source, different logic)
- **related**: claim is about the entity/field but addresses something the YAML doesn't cover (business rules, edge cases, rationale for choices)
- **unanchored**: entity/field couldn't be resolved, or no SOT mapping exists yet

### Confidence Scoring

| Anchor Status | Base Confidence |
|---------------|----------------|
| agrees        | 0.9            |
| related       | 0.6            |
| unanchored    | 0.4            |
| contradicts   | 0.1 (flagged)  |

Modifiers:
- Google Sheet structured data: +0.1
- Slack message from known mapper: +0.05
- Linear issue with "Completed" status: +0.05
- Old message (>6 months): -0.1

## Architecture

### Phase 1: Extract

Three extraction scripts, one per source. Each uses Gestalt for API access and Sonnet for LLM extraction.

```
scripts/harvest/
  extract-slack.ts       — crawl 3 channels, extract claims
  extract-sheets.ts      — read M1+M2 tracker tabs, extract claims
  extract-linear.ts      — read MAP issues + comments, extract claims
  lib/
    claim-extractor.ts   — shared LLM extraction (message → claims)
    entity-resolver.ts   — fuzzy-match entity/field names to VDS schema
    types.ts             — HarvestedClaim interface
    store.ts             — write claims to local JSON/SQLite
```

**Extraction strategy:**
- Slack: fetch channel history, batch messages into conversation windows (~10 messages), send each window to Sonnet with prompt: "Extract any claims about field mappings, data transformations, or mapping decisions from this conversation."
- Sheets: read rows, each row with notes/comments becomes a claim directly (structured data, minimal LLM needed)
- Linear: fetch issues + comments for MAP project, extract claims from comment threads

**Entity/field resolution:**
- Load all VDS entity and field names from Surveyor DB
- Use fuzzy matching (Levenshtein + alias table) to resolve mentions like "the address table" → `address`, "prop address" → `address_property`
- LLM fallback for ambiguous cases

### Phase 2: Anchor & Score

```
scripts/harvest/
  anchor-claims.ts       — compare claims against SOT YAML
  lib/
    sot-loader.ts        — parse M1/M2 YAML into structured lookup
    anchor-scorer.ts     — LLM comparison: claim vs SOT mapping → status
```

**SOT loader** reads YAML files from `analytics/platform/sdt_mapping/{m1,m2}_mappings/` and builds a lookup: `{entity}.{field}` → `{ sources, transformation, notes }`.

**Anchor scoring**: For each claim with a resolved entity+field, send to Sonnet:
- Input: claim text + SOT YAML excerpt for that field
- Output: `{ status: "agrees"|"contradicts"|"related", detail: "..." }`

Claims without a matching SOT entry get `unanchored`.

### Phase 3: Load into Surveyor

```
scripts/harvest/
  load-claims.ts         — write surviving claims to Surveyor context table
```

**Loading strategy:**
- Group surviving claims (agrees + related + unanchored with confidence >= 0.4) by entity
- Render each entity's claims as a markdown context document
- Write to Surveyor's `context` table with:
  - `category`: "adhoc"
  - `subcategory`: "extract" (existing subcategory, semantically correct)
  - `importSource`: "context_harvester"
  - `metadata`: `{ harvest_date, source_counts, avg_confidence }`
  - `name`: `Harvested Knowledge > {entity_name}`
- Tag with `["harvested", entity_name, milestone]`

**Context assembly integration:**
- Harvested docs flow through existing FTS5 + skill matching
- They'll appear as supplementary context (lower priority than EK and primary schemas)
- The `importSource: "context_harvester"` distinguishes them from human-authored context
- No changes needed to `context-assembler.ts` — it already handles adhoc/extract contexts

**Contradicting claims** are written to a separate report file for human review, not loaded into context.

## Rendered Document Format

```markdown
# Harvested Knowledge: address

## Confirmed Mappings (agrees with SOT)

- **address_line_1**: Maps from LoanInfo.PropAddr1 via staging address_property table.
  Confirmed in Slack by @jane (2025-09-15). [slack:#proj-ocean-acdc-transform/1694793600]

## Related Context (not in SOT)

- **address_property**: Property addresses require USPS standardization before loading.
  Business rule discussed in dry run retro. [slack:#proj-m1-dry-runs/1695312000]

- **Entity-level**: Address entity uses a UNION ALL pattern across 13 sub-tables,
  each representing a different address role. [sheet:M1-tracker/B45]

## Unanchored (no SOT mapping found)

- **seasonal_address_flag**: ServiceMac tracks seasonal addresses separately;
  unclear if this maps to VDS. [linear:MAP-234]
```

## Cost Estimate

| Phase | Model | Est. Tokens | Est. Cost |
|-------|-------|-------------|-----------|
| Extract (Slack) | Sonnet | ~1-2.5M in | $3-8 |
| Extract (Sheets) | Sonnet | ~200K in | $1-2 |
| Extract (Linear) | Sonnet | ~500K-1M in | $3-6 |
| Anchor & Score | Sonnet | ~500K in | $2-5 |
| **Total** | | | **$10-20** |

## What This Does NOT Do

- Does not modify existing Entity Knowledge docs (those stay human-curated)
- Does not run automatically / on a schedule (one-off, repeatable if needed)
- Does not change the context assembler priority logic
- Does not ingest Confluence or Notion (can be added later with same pattern)

## Future: Standardizing the Pattern

If this proves valuable, the extraction scripts become a reusable pipeline:
1. Add new source adapters (Confluence, Notion, GitLab MRs)
2. Schedule periodic re-harvests as a Surveyor admin action
3. Add a "Harvested Context" tab in the admin UI to review/approve claims before loading
4. Use the contradiction report as a data quality signal
