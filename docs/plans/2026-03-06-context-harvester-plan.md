# Context Harvester Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** One-off harvest of mapping decisions from Slack, Linear, and Google Sheets into Surveyor context, anchored against SOT YAML truth.

**Architecture:** Three-phase pipeline (Extract → Anchor → Load). Extraction scripts use Gestalt API for Slack/Linear and Google Sheets. Sonnet classifies raw text into structured claims. Claims are compared against M1/M2 SOT YAML, scored, and surviving claims are loaded into Surveyor's `context` table as `adhoc/extract` with `importSource: "context_harvester"`.

**Tech Stack:** TypeScript scripts in `scripts/harvest/`, Gestalt REST API, Anthropic Sonnet, SOT YAML from analytics repo, Drizzle ORM for Surveyor DB writes.

**Prerequisites:**
- Slack must be connected to Gestalt at https://gestalt.peachstreet.dev/integrations (currently not connected)
- Google Sheets Gestalt API has a bug escaping `!` in range params — workaround: download tracker tabs as CSV first (see Task 3)
- `GESTALT_API_KEY` and `ANTHROPIC_API_KEY` in `.env.local`

---

### Task 1: Shared Types and Utilities

**Files:**
- Create: `scripts/harvest/lib/types.ts`
- Create: `scripts/harvest/lib/gestalt-client.ts`
- Create: `scripts/harvest/lib/store.ts`

**Step 1: Create types**

```typescript
// scripts/harvest/lib/types.ts
export interface HarvestedClaim {
  id: string;
  source: "slack" | "linear" | "google_sheet";
  sourceRef: string;
  milestone: "M1" | "M2" | "M2.5";
  entityName: string | null;
  fieldName: string | null;
  claimText: string;
  claimType: "mapping_logic" | "transformation_rule" | "business_rule" | "rationale" | "question_answer";
  anchorStatus: "agrees" | "contradicts" | "related" | "unanchored";
  anchorDetail: string | null;
  confidence: number;
  rawContent: string;
  createdAt: string;
}

export interface SotMapping {
  entity: string;
  field: string;
  sources: { name: string; alias: string; staging: string }[];
  transform: string;
  dtype: string;
  sourceColumn: string | null;
}

export interface ExtractionWindow {
  messages: { author: string; text: string; ts: string }[];
  source: string;
  sourceRef: string;
}
```

**Step 2: Create Gestalt HTTP client**

The existing `src/lib/linear/gestalt-linear-client.ts` uses `fetch` with `GESTALT_API_KEY`. Create a generic version for scripts.

```typescript
// scripts/harvest/lib/gestalt-client.ts
const GESTALT_BASE = "https://api.gestalt.peachstreet.dev/api/v1";

function getApiKey(): string {
  const key = process.env.GESTALT_API_KEY;
  if (!key) throw new Error("GESTALT_API_KEY not set");
  return key;
}

export async function gestaltGet<T = unknown>(
  integration: string,
  operation: string,
  params: Record<string, string> = {},
): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const url = `${GESTALT_BASE}/${integration}/${operation}${qs ? "?" + qs : ""}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${getApiKey()}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gestalt ${integration}/${operation} failed (${res.status}): ${text}`);
  }
  const json = await res.json();
  if (json.status === "error") throw new Error(`Gestalt error: ${json.error?.message}`);
  return json.data as T;
}

export async function linearGql<T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const body: Record<string, unknown> = { query };
  if (variables) body.variables = JSON.stringify(variables);

  const res = await fetch(`${GESTALT_BASE}/linear/gql`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gestalt Linear GQL failed (${res.status}): ${text}`);
  }
  const json = await res.json();
  if (json.errors) throw new Error(`Linear GQL errors: ${JSON.stringify(json.errors)}`);
  return json.data as T;
}
```

**Step 3: Create claim store (JSON file-based)**

```typescript
// scripts/harvest/lib/store.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import type { HarvestedClaim } from "./types";

const DATA_DIR = "scripts/harvest/data";

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

export function loadClaims(filename: string): HarvestedClaim[] {
  const path = `${DATA_DIR}/${filename}`;
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function saveClaims(filename: string, claims: HarvestedClaim[]): void {
  ensureDir();
  writeFileSync(`${DATA_DIR}/${filename}`, JSON.stringify(claims, null, 2));
  console.log(`Saved ${claims.length} claims to ${DATA_DIR}/${filename}`);
}

export function loadAllClaims(): HarvestedClaim[] {
  ensureDir();
  const files = ["slack-claims.json", "sheets-claims.json", "linear-claims.json"];
  return files.flatMap((f) => loadClaims(f));
}
```

**Step 4: Verify directory structure**

Run: `mkdir -p scripts/harvest/lib scripts/harvest/data`

**Step 5: Commit**

```bash
git add scripts/harvest/lib/types.ts scripts/harvest/lib/gestalt-client.ts scripts/harvest/lib/store.ts
git commit -m "feat(harvest): add shared types, Gestalt client, and claim store"
```

---

### Task 2: Entity Resolver

Loads VDS entity and field names from Surveyor DB and provides fuzzy matching to resolve mentions in raw text.

**Files:**
- Create: `scripts/harvest/lib/entity-resolver.ts`

**Step 1: Build the resolver**

```typescript
// scripts/harvest/lib/entity-resolver.ts

interface EntityField {
  entityName: string;
  entityDisplayName: string;
  fieldName: string;
  fieldDisplayName: string | null;
}

let fieldIndex: EntityField[] = [];
let entityNames: string[] = [];

/**
 * Load all VDS entity+field names from Surveyor DB.
 * Call once at startup before resolving.
 */
export async function loadEntityIndex(): Promise<void> {
  const { db } = await import("../../src/lib/db");
  const { entity, field } = await import("../../src/lib/db/schema");
  const { eq } = await import("drizzle-orm");

  const entities = await db
    .select({ id: entity.id, name: entity.name, displayName: entity.displayName, side: entity.side })
    .from(entity)
    .where(eq(entity.side, "target"));

  entityNames = entities.map((e) => e.displayName || e.name);

  for (const e of entities) {
    const fields = await db
      .select({ name: field.name, displayName: field.displayName })
      .from(field)
      .where(eq(field.entityId, e.id));

    for (const f of fields) {
      fieldIndex.push({
        entityName: e.name,
        entityDisplayName: e.displayName || e.name,
        fieldName: f.name,
        fieldDisplayName: f.displayName,
      });
    }
  }

  console.log(`Loaded ${entityNames.length} entities, ${fieldIndex.length} fields`);
}

/**
 * Normalize a name for fuzzy matching: lowercase, strip underscores/spaces/hyphens.
 */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[_\s-]/g, "");
}

/**
 * Resolve an entity name mention to a canonical VDS entity name.
 * Returns null if no match found.
 */
export function resolveEntity(mention: string): string | null {
  const norm = normalize(mention);
  // Exact match
  const exact = entityNames.find((e) => normalize(e) === norm);
  if (exact) return exact;
  // Substring match (mention contains entity name or vice versa)
  const sub = entityNames.find(
    (e) => norm.includes(normalize(e)) || normalize(e).includes(norm),
  );
  return sub || null;
}

/**
 * Resolve a field name mention within an entity context.
 * Returns { entityName, fieldName } or null.
 */
export function resolveField(
  entityHint: string | null,
  fieldMention: string,
): { entityName: string; fieldName: string } | null {
  const fieldNorm = normalize(fieldMention);

  const candidates = entityHint
    ? fieldIndex.filter((f) => normalize(f.entityName) === normalize(entityHint))
    : fieldIndex;

  const match = candidates.find(
    (f) =>
      normalize(f.fieldName) === fieldNorm ||
      (f.fieldDisplayName && normalize(f.fieldDisplayName) === fieldNorm),
  );

  return match ? { entityName: match.entityName, fieldName: match.fieldName } : null;
}

/**
 * Get all entity names for use in LLM prompts.
 */
export function getEntityNames(): string[] {
  return entityNames;
}
```

**Step 2: Commit**

```bash
git add scripts/harvest/lib/entity-resolver.ts
git commit -m "feat(harvest): add entity resolver with fuzzy matching"
```

---

### Task 3: SOT YAML Loader

Parses M1/M2 SOT YAML files into a lookup table for anchor comparison.

**Files:**
- Create: `scripts/harvest/lib/sot-loader.ts`

**Step 1: Build the SOT loader**

The YAML structure (from `analytics/platform/sdt_mapping/m1_mappings/address.yaml`):
```yaml
table: address
sources:
  - name: address_property
    alias: prop
    staging: {table: "address_property"}
columns:
  - target_column: address_id
    source: address_id
    transform: identity
    dtype: string
```

```typescript
// scripts/harvest/lib/sot-loader.ts
import { readFileSync, readdirSync } from "fs";
import { parse as parseYaml } from "yaml";
import type { SotMapping } from "./types";

const M1_PATH = "/Users/rob/code/analytics/analytics/platform/sdt_mapping/m1_mappings";
const M2_PATH = "/Users/rob/code/analytics/analytics/platform/sdt_mapping/m2_mappings";

interface YamlSource {
  name: string;
  alias: string;
  staging: { table: string };
}

interface YamlColumn {
  target_column: string;
  source: string;
  transform: string;
  dtype: string;
  sources?: string[];  // some columns list multiple source aliases
}

interface YamlMapping {
  table: string;
  sources: YamlSource[];
  columns: YamlColumn[];
}

/**
 * Load all SOT YAML mappings into a lookup: "entity.field" → SotMapping.
 */
export function loadSotMappings(milestone: "M1" | "M2"): Map<string, SotMapping> {
  const dir = milestone === "M1" ? M1_PATH : M2_PATH;
  const lookup = new Map<string, SotMapping>();

  const files = readdirSync(dir).filter((f) => f.endsWith(".yaml"));

  for (const file of files) {
    try {
      const raw = readFileSync(`${dir}/${file}`, "utf-8");
      const yaml = parseYaml(raw) as YamlMapping;
      if (!yaml.table || !yaml.columns) continue;

      const entity = yaml.table;
      const sources = (yaml.sources || []).map((s) => ({
        name: s.name,
        alias: s.alias,
        staging: s.staging?.table || s.name,
      }));

      for (const col of yaml.columns) {
        const key = `${entity}.${col.target_column}`;
        lookup.set(key, {
          entity,
          field: col.target_column,
          sources,
          transform: col.transform || "identity",
          dtype: col.dtype || "string",
          sourceColumn: col.source || null,
        });
      }
    } catch (e) {
      console.warn(`Failed to parse ${file}: ${(e as Error).message}`);
    }
  }

  console.log(`Loaded ${lookup.size} SOT mappings from ${milestone} (${files.length} files)`);
  return lookup;
}

/**
 * Find the SOT mapping for a given entity+field.
 */
export function findSotMapping(
  lookup: Map<string, SotMapping>,
  entityName: string,
  fieldName: string,
): SotMapping | null {
  return lookup.get(`${entityName}.${fieldName}`) || null;
}
```

**Step 2: Quick test**

Run: `cd /Users/rob/code/surveyor && npx tsx -e "
const { loadSotMappings } = require('./scripts/harvest/lib/sot-loader');
const m1 = loadSotMappings('M1');
console.log('M1 entries:', m1.size);
const sample = m1.get('address.city');
console.log('address.city:', sample);
"`

Expected: prints count of M1 mappings and the address.city mapping details.

**Step 3: Commit**

```bash
git add scripts/harvest/lib/sot-loader.ts
git commit -m "feat(harvest): add SOT YAML loader for M1/M2 mappings"
```

---

### Task 4: LLM Claim Extractor

Shared module that takes a text window and uses Sonnet to extract structured claims.

**Files:**
- Create: `scripts/harvest/lib/claim-extractor.ts`

**Step 1: Build the extractor**

```typescript
// scripts/harvest/lib/claim-extractor.ts
import Anthropic from "@anthropic-ai/sdk";
import type { HarvestedClaim } from "./types";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
    client = new Anthropic({ apiKey });
  }
  return client;
}

const EXTRACTION_PROMPT = `You are extracting structured claims about data field mappings from conversation or documentation text.

A "claim" is any statement about:
- How a source field maps to a target field (mapping_logic)
- Data transformations applied during mapping (transformation_rule)
- Business rules that affect mapping decisions (business_rule)
- Reasoning or rationale for why a mapping was chosen (rationale)
- A question that was asked and answered about a mapping (question_answer)

For each claim found, extract:
- entity_name: The VDS target entity/table mentioned (e.g., "address", "loan", "escrow_analysis"). null if unclear.
- field_name: The specific target field mentioned (e.g., "city", "loan_id"). null if entity-level.
- claim_text: A concise, self-contained statement of the claim. Should make sense without the surrounding context.
- claim_type: One of: mapping_logic, transformation_rule, business_rule, rationale, question_answer

Here are the known VDS entity names for reference:
{entity_names}

Return a JSON array of claims. If no mapping-related claims are found, return an empty array [].

IMPORTANT: Only extract claims that contain actionable information about field mappings. Skip small talk, status updates without mapping details, and messages that just say "done" or "working on it".`;

interface RawClaim {
  entity_name: string | null;
  field_name: string | null;
  claim_text: string;
  claim_type: HarvestedClaim["claimType"];
}

export async function extractClaims(
  text: string,
  entityNames: string[],
  source: HarvestedClaim["source"],
  sourceRef: string,
  milestone: HarvestedClaim["milestone"],
): Promise<HarvestedClaim[]> {
  const anthropic = getClient();

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `Extract mapping claims from the following text:\n\n${text}`,
      },
    ],
    system: EXTRACTION_PROMPT.replace("{entity_names}", entityNames.join(", ")),
  });

  const content = response.content[0];
  if (content.type !== "text") return [];

  // Parse JSON from response (handle markdown code blocks)
  let jsonStr = content.text.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();

  let rawClaims: RawClaim[];
  try {
    rawClaims = JSON.parse(jsonStr);
  } catch {
    console.warn(`Failed to parse claims JSON from ${sourceRef}`);
    return [];
  }

  if (!Array.isArray(rawClaims)) return [];

  return rawClaims.map((rc) => ({
    id: crypto.randomUUID(),
    source,
    sourceRef,
    milestone,
    entityName: rc.entity_name,
    fieldName: rc.field_name,
    claimText: rc.claim_text,
    claimType: rc.claim_type || "mapping_logic",
    anchorStatus: "unanchored" as const,
    anchorDetail: null,
    confidence: 0,
    rawContent: text.slice(0, 500),
    createdAt: new Date().toISOString(),
  }));
}

/**
 * Track token usage for cost estimation.
 */
let totalInputTokens = 0;
let totalOutputTokens = 0;

export function getTokenUsage() {
  return { totalInputTokens, totalOutputTokens };
}
```

**Step 2: Commit**

```bash
git add scripts/harvest/lib/claim-extractor.ts
git commit -m "feat(harvest): add LLM claim extractor using Sonnet"
```

---

### Task 5: Extract from Google Sheets

**Files:**
- Create: `scripts/harvest/extract-sheets.ts`

**Gestalt Sheets API workaround:** The `get_values` endpoint has a bug escaping `!` in range params, making it impossible to address specific tabs. Workaround: use `get_spreadsheet` with `include_grid_data=true` for the specific sheet gids, OR pre-download the tabs as CSV.

Since this is a one-off, the simplest approach is to download the two tabs as CSV files first, then parse locally.

**Step 1: Download tracker CSVs manually**

Open the Google Sheet URL, go to each tab, and File > Download > CSV:
- `VDS M1 Tracker` → save as `scripts/harvest/data/m1-tracker.csv`
- `VDS M2 Tracker` → save as `scripts/harvest/data/m2-tracker.csv`

Alternatively, attempt the Gestalt `get_spreadsheet` approach with `include_grid_data=true` (no range filter needed — just filter sheets by title in the response).

**Step 2: Write the extraction script**

```typescript
// scripts/harvest/extract-sheets.ts
/**
 * Extract mapping claims from M1 and M2 tracker Google Sheets.
 *
 * Usage:
 *   1. Download CSVs: M1 Tracker → data/m1-tracker.csv, M2 Tracker → data/m2-tracker.csv
 *   2. npx tsx scripts/harvest/extract-sheets.ts
 *
 * OR use --gestalt to attempt direct API fetch (may fail due to Gestalt bug).
 */
import { readFileSync } from "fs";
// Load env
for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const idx = line.indexOf("=");
  if (idx < 1 || line.trimStart().startsWith("#")) continue;
  process.env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/\r$/, "");
}

import { parse as parseCsv } from "papaparse";
import { saveClaims } from "./lib/store";
import { extractClaims } from "./lib/claim-extractor";
import { loadEntityIndex, getEntityNames, resolveEntity, resolveField } from "./lib/entity-resolver";
import type { HarvestedClaim } from "./lib/types";

// M1 tracker: Col A = VDS Table, Col B = VDS Field, Col F = In M1 Population
// M2 tracker: Col A = VDS Table, Col B = VDS Field, Col D = In M2 Population
// Exact column indices will be confirmed from header row.

interface TrackerRow {
  entity: string;
  field: string;
  inPopulation: boolean;
  notes: string;          // any columns with notes, comments, mapping info
  rowIndex: number;
}

function parseTrackerCsv(
  csvPath: string,
  entityCol: number,
  fieldCol: number,
  populationCol: number,
  populationYesValues: string[],
  notesCols: number[],
): TrackerRow[] {
  const raw = readFileSync(csvPath, "utf-8");
  const { data } = parseCsv(raw, { header: false });
  const rows = data as string[][];

  // Skip header
  return rows.slice(1)
    .map((row, i) => ({
      entity: (row[entityCol] || "").trim(),
      field: (row[fieldCol] || "").trim(),
      inPopulation: populationYesValues.some(
        (v) => (row[populationCol] || "").trim().toUpperCase() === v.toUpperCase(),
      ),
      notes: notesCols.map((c) => (row[c] || "").trim()).filter(Boolean).join(" | "),
      rowIndex: i + 2, // 1-indexed + header
    }))
    .filter((r) => r.entity && r.inPopulation);
}

async function main() {
  await loadEntityIndex();
  const entityNames = getEntityNames();
  const allClaims: HarvestedClaim[] = [];

  // -- M1 Tracker --
  const m1Path = "scripts/harvest/data/m1-tracker.csv";
  try {
    // Column indices will need adjustment based on actual CSV header.
    // Expected: A=VDS Table, B=VDS Field, F=In M1 Population
    // Notes columns: any with "notes", "mapping", "logic", "comments"
    console.log("Parsing M1 tracker...");
    const m1Rows = parseTrackerCsv(m1Path, 0, 1, 5, ["YES", "Y"], [6, 7, 8, 9]);
    console.log(`M1: ${m1Rows.length} in-population rows`);

    // Group rows by entity for batch extraction
    const byEntity = new Map<string, TrackerRow[]>();
    for (const row of m1Rows) {
      const key = row.entity;
      if (!byEntity.has(key)) byEntity.set(key, []);
      byEntity.get(key)!.push(row);
    }

    for (const [entityName, rows] of byEntity) {
      const rowsWithNotes = rows.filter((r) => r.notes);
      if (rowsWithNotes.length === 0) continue;

      const text = rowsWithNotes
        .map((r) => `Field: ${r.field} | Notes: ${r.notes}`)
        .join("\n");

      const claims = await extractClaims(
        `M1 Mapping Tracker - Entity: ${entityName}\n\n${text}`,
        entityNames,
        "google_sheet",
        `sheet:M1-tracker`,
        "M1",
      );

      // Resolve entity/field names
      for (const claim of claims) {
        if (!claim.entityName) claim.entityName = resolveEntity(entityName);
        if (claim.fieldName) {
          const resolved = resolveField(claim.entityName, claim.fieldName);
          if (resolved) {
            claim.entityName = resolved.entityName;
            claim.fieldName = resolved.fieldName;
          }
        }
      }

      allClaims.push(...claims);
      console.log(`  ${entityName}: ${claims.length} claims`);
    }
  } catch (e) {
    console.warn(`Skipping M1 tracker: ${(e as Error).message}`);
    console.warn("Download 'VDS M1 Tracker' tab as CSV to scripts/harvest/data/m1-tracker.csv");
  }

  // -- M2 Tracker --
  const m2Path = "scripts/harvest/data/m2-tracker.csv";
  try {
    console.log("Parsing M2 tracker...");
    const m2Rows = parseTrackerCsv(m2Path, 0, 1, 3, ["YES", "Y"], [4, 5, 6, 7]);
    console.log(`M2: ${m2Rows.length} in-population rows`);

    const byEntity = new Map<string, TrackerRow[]>();
    for (const row of m2Rows) {
      const key = row.entity;
      if (!byEntity.has(key)) byEntity.set(key, []);
      byEntity.get(key)!.push(row);
    }

    for (const [entityName, rows] of byEntity) {
      const rowsWithNotes = rows.filter((r) => r.notes);
      if (rowsWithNotes.length === 0) continue;

      const text = rowsWithNotes
        .map((r) => `Field: ${r.field} | Notes: ${r.notes}`)
        .join("\n");

      const claims = await extractClaims(
        `M2 Mapping Tracker - Entity: ${entityName}\n\n${text}`,
        entityNames,
        "google_sheet",
        `sheet:M2-tracker`,
        "M2",
      );

      for (const claim of claims) {
        if (!claim.entityName) claim.entityName = resolveEntity(entityName);
        if (claim.fieldName) {
          const resolved = resolveField(claim.entityName, claim.fieldName);
          if (resolved) {
            claim.entityName = resolved.entityName;
            claim.fieldName = resolved.fieldName;
          }
        }
      }

      allClaims.push(...claims);
      console.log(`  ${entityName}: ${claims.length} claims`);
    }
  } catch (e) {
    console.warn(`Skipping M2 tracker: ${(e as Error).message}`);
    console.warn("Download 'VDS M2 Tracker' tab as CSV to scripts/harvest/data/m2-tracker.csv");
  }

  saveClaims("sheets-claims.json", allClaims);
  console.log(`\nTotal: ${allClaims.length} claims from Google Sheets`);
}

main().catch(console.error);
```

**Step 3: Commit**

```bash
git add scripts/harvest/extract-sheets.ts
git commit -m "feat(harvest): add Google Sheets extraction script"
```

---

### Task 6: Extract from Slack

**Files:**
- Create: `scripts/harvest/extract-slack.ts`

**Prerequisite:** Connect Slack to Gestalt at https://gestalt.peachstreet.dev/integrations first.

**Gestalt Slack API:**
- `GET /slack/list_channels` → find channel IDs
- `GET /slack/get_channel_history?channel={id}&limit=1000` → messages
- `GET /slack/search_messages?query={text}&count=100` → search

**Step 1: Write the extraction script**

```typescript
// scripts/harvest/extract-slack.ts
/**
 * Extract mapping claims from Slack channels.
 *
 * Prerequisite: Connect Slack to Gestalt at https://gestalt.peachstreet.dev/integrations
 *
 * Usage: npx tsx scripts/harvest/extract-slack.ts [--dry-run]
 *
 * Channels:
 *   - #proj-ocean-acdc-transform
 *   - #systems-data-transfer
 *   - #proj-m1-dry-runs
 */
import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const idx = line.indexOf("=");
  if (idx < 1 || line.trimStart().startsWith("#")) continue;
  process.env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/\r$/, "");
}

import { gestaltGet } from "./lib/gestalt-client";
import { saveClaims } from "./lib/store";
import { extractClaims } from "./lib/claim-extractor";
import { loadEntityIndex, getEntityNames, resolveEntity, resolveField } from "./lib/entity-resolver";
import type { HarvestedClaim } from "./lib/types";

const DRY_RUN = process.argv.includes("--dry-run");

const TARGET_CHANNELS = [
  "proj-ocean-acdc-transform",
  "systems-data-transfer",
  "proj-m1-dry-runs",
];

const WINDOW_SIZE = 10; // messages per extraction window

interface SlackMessage {
  ts: string;
  text: string;
  user?: string;
  username?: string;
  type: string;
}

interface SlackChannel {
  id: string;
  name: string;
}

async function fetchChannelHistory(channelId: string): Promise<SlackMessage[]> {
  const allMessages: SlackMessage[] = [];
  let cursor: string | undefined;

  // Paginate through channel history
  while (true) {
    const params: Record<string, string> = { channel: channelId, limit: "200" };
    if (cursor) params.cursor = cursor;

    const data = await gestaltGet<{
      messages: SlackMessage[];
      has_more?: boolean;
      response_metadata?: { next_cursor?: string };
    }>("slack", "get_channel_history", params);

    allMessages.push(...(data.messages || []));

    if (!data.has_more || !data.response_metadata?.next_cursor) break;
    cursor = data.response_metadata.next_cursor;
  }

  return allMessages.filter((m) => m.type === "message" && m.text);
}

async function main() {
  await loadEntityIndex();
  const entityNames = getEntityNames();
  const allClaims: HarvestedClaim[] = [];

  // Find target channels
  const channelList = await gestaltGet<{ channels: SlackChannel[] }>(
    "slack", "list_channels", { limit: "500" },
  );

  for (const targetName of TARGET_CHANNELS) {
    const channel = channelList.channels?.find(
      (c) => c.name === targetName || c.name === targetName.replace(/^#/, ""),
    );

    if (!channel) {
      console.warn(`Channel #${targetName} not found, skipping`);
      continue;
    }

    console.log(`\nFetching #${channel.name} (${channel.id})...`);
    const messages = await fetchChannelHistory(channel.id);
    console.log(`  ${messages.length} messages`);

    if (DRY_RUN) {
      console.log(`  [dry-run] Would process ${Math.ceil(messages.length / WINDOW_SIZE)} windows`);
      continue;
    }

    // Batch messages into windows
    for (let i = 0; i < messages.length; i += WINDOW_SIZE) {
      const window = messages.slice(i, i + WINDOW_SIZE);
      const text = window
        .map((m) => `[${m.username || m.user || "unknown"}] ${m.text}`)
        .join("\n");

      const firstTs = window[0]?.ts || "";
      const sourceRef = `slack:#${channel.name}/${firstTs}`;

      const claims = await extractClaims(
        `Slack conversation in #${channel.name}:\n\n${text}`,
        entityNames,
        "slack",
        sourceRef,
        "M1", // These channels are primarily M1
      );

      // Resolve entity/field names
      for (const claim of claims) {
        if (claim.entityName) {
          const resolved = resolveEntity(claim.entityName);
          if (resolved) claim.entityName = resolved;
        }
        if (claim.fieldName && claim.entityName) {
          const resolvedField = resolveField(claim.entityName, claim.fieldName);
          if (resolvedField) {
            claim.entityName = resolvedField.entityName;
            claim.fieldName = resolvedField.fieldName;
          }
        }
      }

      allClaims.push(...claims);

      if (claims.length > 0) {
        console.log(`  Window ${Math.floor(i / WINDOW_SIZE) + 1}: ${claims.length} claims`);
      }

      // Rate limit: ~1 req/sec to Anthropic
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  saveClaims("slack-claims.json", allClaims);
  console.log(`\nTotal: ${allClaims.length} claims from Slack`);
}

main().catch(console.error);
```

**Step 2: Commit**

```bash
git add scripts/harvest/extract-slack.ts
git commit -m "feat(harvest): add Slack extraction script"
```

---

### Task 7: Extract from Linear

**Files:**
- Create: `scripts/harvest/extract-linear.ts`

**Step 1: Write the extraction script**

Uses the existing Gestalt Linear GQL pattern from `src/lib/linear/gestalt-linear-client.ts`. Fetches MAP project issues + comments.

```typescript
// scripts/harvest/extract-linear.ts
/**
 * Extract mapping claims from Linear MAP project issues and comments.
 *
 * Usage: npx tsx scripts/harvest/extract-linear.ts [--dry-run]
 */
import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const idx = line.indexOf("=");
  if (idx < 1 || line.trimStart().startsWith("#")) continue;
  process.env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/\r$/, "");
}

import { linearGql } from "./lib/gestalt-client";
import { saveClaims } from "./lib/store";
import { extractClaims } from "./lib/claim-extractor";
import { loadEntityIndex, getEntityNames, resolveEntity, resolveField } from "./lib/entity-resolver";
import type { HarvestedClaim } from "./lib/types";

const DRY_RUN = process.argv.includes("--dry-run");

// MAP team ID from memory
const MAP_TEAM_ID = "6506fc68-25a5-4568-8a00-234bb9cb5ef6";

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  state: { name: string };
  labels: { nodes: { name: string }[] };
  comments: { nodes: { body: string; user: { name: string } | null; createdAt: string }[] };
}

async function fetchIssuesWithComments(): Promise<LinearIssue[]> {
  const all: LinearIssue[] = [];
  let cursor: string | null = null;

  while (true) {
    const afterClause = cursor ? `, after: "${cursor}"` : "";
    const query = `{
      issues(
        filter: { team: { id: { eq: "${MAP_TEAM_ID}" } } },
        first: 50${afterClause}
      ) {
        nodes {
          id
          identifier
          title
          description
          state { name }
          labels { nodes { name } }
          comments {
            nodes {
              body
              user { name }
              createdAt
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }`;

    type Response = {
      issues: {
        nodes: LinearIssue[];
        pageInfo: { hasNextPage: boolean; endCursor: string };
      };
    };

    const data = await linearGql<Response>(query);
    all.push(...data.issues.nodes);

    if (!data.issues.pageInfo.hasNextPage) break;
    cursor = data.issues.pageInfo.endCursor;
  }

  return all;
}

/**
 * Parse VDS entity name from Linear issue title.
 * Titles often follow pattern: "entity_name.field_name - description"
 */
function parseEntityFromTitle(title: string): { entity: string | null; field: string | null } {
  // Pattern: "entity.field" or "entity > field"
  const dotMatch = title.match(/^([a-z_]+)\.([a-z_]+)/i);
  if (dotMatch) return { entity: dotMatch[1], field: dotMatch[2] };

  const arrowMatch = title.match(/^([a-z_]+)\s*>\s*([a-z_]+)/i);
  if (arrowMatch) return { entity: arrowMatch[1], field: arrowMatch[2] };

  return { entity: null, field: null };
}

async function main() {
  await loadEntityIndex();
  const entityNames = getEntityNames();
  const allClaims: HarvestedClaim[] = [];

  console.log("Fetching MAP team issues with comments...");
  const issues = await fetchIssuesWithComments();
  console.log(`Fetched ${issues.length} issues`);

  // Filter to issues with substantive content
  const withContent = issues.filter(
    (i) =>
      (i.description && i.description.length > 50) ||
      i.comments.nodes.length > 0,
  );
  console.log(`${withContent.length} issues with content`);

  if (DRY_RUN) {
    console.log(`[dry-run] Would process ${withContent.length} issues`);
    process.exit(0);
  }

  for (const issue of withContent) {
    // Build text from description + comments
    const parts: string[] = [];
    if (issue.description) {
      parts.push(`Issue description:\n${issue.description}`);
    }
    for (const c of issue.comments.nodes) {
      parts.push(`Comment by ${c.user?.name || "unknown"}:\n${c.body}`);
    }

    const text = parts.join("\n\n---\n\n");
    const sourceRef = `linear:${issue.identifier}`;

    // Determine milestone from labels
    const labels = issue.labels.nodes.map((l) => l.name);
    const milestone: HarvestedClaim["milestone"] = labels.includes("M2.5")
      ? "M2.5"
      : labels.includes("M2")
        ? "M2"
        : "M2"; // Default M2 for MAP team

    const claims = await extractClaims(
      `Linear issue ${issue.identifier}: "${issue.title}"\n\n${text}`,
      entityNames,
      "linear",
      sourceRef,
      milestone,
    );

    // Resolve entity/field from issue title if LLM didn't find them
    const { entity: titleEntity, field: titleField } = parseEntityFromTitle(issue.title);
    for (const claim of claims) {
      if (!claim.entityName && titleEntity) {
        claim.entityName = resolveEntity(titleEntity);
      }
      if (!claim.fieldName && titleField && claim.entityName) {
        const resolved = resolveField(claim.entityName, titleField);
        if (resolved) claim.fieldName = resolved.fieldName;
      }
      if (claim.entityName) {
        const resolved = resolveEntity(claim.entityName);
        if (resolved) claim.entityName = resolved;
      }
    }

    allClaims.push(...claims);

    if (claims.length > 0) {
      console.log(`  ${issue.identifier}: ${claims.length} claims`);
    }

    // Rate limit
    await new Promise((r) => setTimeout(r, 500));
  }

  saveClaims("linear-claims.json", allClaims);
  console.log(`\nTotal: ${allClaims.length} claims from Linear`);
}

main().catch(console.error);
```

**Step 2: Commit**

```bash
git add scripts/harvest/extract-linear.ts
git commit -m "feat(harvest): add Linear extraction script"
```

---

### Task 8: Anchor & Score Claims

**Files:**
- Create: `scripts/harvest/anchor-claims.ts`

**Step 1: Write the anchor/score script**

```typescript
// scripts/harvest/anchor-claims.ts
/**
 * Compare extracted claims against SOT YAML mappings and score them.
 *
 * Usage: npx tsx scripts/harvest/anchor-claims.ts [--dry-run]
 *
 * Reads: scripts/harvest/data/{slack,sheets,linear}-claims.json
 * Writes: scripts/harvest/data/anchored-claims.json
 *         scripts/harvest/data/contradictions-report.json
 */
import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const idx = line.indexOf("=");
  if (idx < 1 || line.trimStart().startsWith("#")) continue;
  process.env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/\r$/, "");
}

import Anthropic from "@anthropic-ai/sdk";
import { loadAllClaims, saveClaims } from "./lib/store";
import { loadSotMappings, findSotMapping } from "./lib/sot-loader";
import type { HarvestedClaim, SotMapping } from "./lib/types";

const DRY_RUN = process.argv.includes("--dry-run");

const ANCHOR_PROMPT = `You are comparing a claim about a data field mapping against the ground-truth Source of Truth (SOT) YAML mapping.

Determine the relationship:
- "agrees": The claim describes the same source, transformation, or logic as the SOT mapping.
- "contradicts": The claim conflicts with the SOT mapping (different source, different transformation, wrong table).
- "related": The claim is about this field but covers something the SOT doesn't specify (business rules, rationale, edge cases, context).

Return JSON: { "status": "agrees"|"contradicts"|"related", "detail": "brief explanation" }`;

async function anchorClaim(
  claim: HarvestedClaim,
  sotMapping: SotMapping,
  anthropic: Anthropic,
): Promise<{ status: HarvestedClaim["anchorStatus"]; detail: string }> {
  const sotSummary = [
    `Entity: ${sotMapping.entity}`,
    `Field: ${sotMapping.field}`,
    `Source column: ${sotMapping.sourceColumn || "N/A"}`,
    `Transform: ${sotMapping.transform}`,
    `Data type: ${sotMapping.dtype}`,
    `Source tables: ${sotMapping.sources.map((s) => `${s.name} (${s.staging})`).join(", ")}`,
  ].join("\n");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 256,
    system: ANCHOR_PROMPT,
    messages: [
      {
        role: "user",
        content: `CLAIM: ${claim.claimText}\n\nSOT MAPPING:\n${sotSummary}`,
      },
    ],
  });

  const content = response.content[0];
  if (content.type !== "text") return { status: "related", detail: "Failed to parse" };

  try {
    let jsonStr = content.text.trim();
    const fence = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) jsonStr = fence[1].trim();
    const parsed = JSON.parse(jsonStr);
    return { status: parsed.status, detail: parsed.detail };
  } catch {
    return { status: "related", detail: "Failed to parse anchor response" };
  }
}

function computeConfidence(claim: HarvestedClaim): number {
  // Base confidence from anchor status
  const baseMap: Record<string, number> = {
    agrees: 0.9,
    related: 0.6,
    unanchored: 0.4,
    contradicts: 0.1,
  };
  let conf = baseMap[claim.anchorStatus] || 0.4;

  // Source modifiers
  if (claim.source === "google_sheet") conf += 0.1;
  if (claim.source === "linear") conf += 0.05;

  return Math.min(1, Math.max(0, conf));
}

async function main() {
  const claims = loadAllClaims();
  console.log(`Loaded ${claims.length} claims`);

  if (claims.length === 0) {
    console.log("No claims to anchor. Run extraction scripts first.");
    process.exit(0);
  }

  // Load SOT mappings
  const m1Sot = loadSotMappings("M1");
  const m2Sot = loadSotMappings("M2");

  if (DRY_RUN) {
    const withEntity = claims.filter((c) => c.entityName && c.fieldName);
    console.log(`[dry-run] ${withEntity.length}/${claims.length} claims have entity+field`);
    console.log(`Would need to anchor ${withEntity.length} claims against SOT`);
    process.exit(0);
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  for (const claim of claims) {
    if (!claim.entityName || !claim.fieldName) {
      claim.anchorStatus = "unanchored";
      claim.anchorDetail = "No entity+field resolved";
      claim.confidence = computeConfidence(claim);
      continue;
    }

    // Find SOT mapping based on milestone
    const sot = claim.milestone === "M1"
      ? findSotMapping(m1Sot, claim.entityName, claim.fieldName)
      : findSotMapping(m2Sot, claim.entityName, claim.fieldName);

    if (!sot) {
      claim.anchorStatus = "unanchored";
      claim.anchorDetail = `No SOT mapping found for ${claim.entityName}.${claim.fieldName}`;
      claim.confidence = computeConfidence(claim);
      continue;
    }

    // LLM anchor comparison
    const result = await anchorClaim(claim, sot, anthropic);
    claim.anchorStatus = result.status;
    claim.anchorDetail = result.detail;
    claim.confidence = computeConfidence(claim);

    if (claim.anchorStatus === "contradicts") {
      console.log(`  CONTRADICTION: ${claim.entityName}.${claim.fieldName} — ${result.detail}`);
    }

    // Rate limit
    await new Promise((r) => setTimeout(r, 300));
  }

  // Split results
  const contradictions = claims.filter((c) => c.anchorStatus === "contradicts");
  const surviving = claims.filter((c) => c.anchorStatus !== "contradicts" && c.confidence >= 0.4);

  saveClaims("anchored-claims.json", surviving);
  saveClaims("contradictions-report.json", contradictions);

  // Summary
  const byStatus = { agrees: 0, related: 0, unanchored: 0, contradicts: 0 };
  for (const c of claims) byStatus[c.anchorStatus]++;

  console.log(`\nAnchor results:`);
  console.log(`  Agrees: ${byStatus.agrees}`);
  console.log(`  Related: ${byStatus.related}`);
  console.log(`  Unanchored: ${byStatus.unanchored}`);
  console.log(`  Contradicts: ${byStatus.contradicts}`);
  console.log(`\nSurviving claims: ${surviving.length}`);
  console.log(`Contradictions report: ${contradictions.length}`);
}

main().catch(console.error);
```

**Step 2: Commit**

```bash
git add scripts/harvest/anchor-claims.ts
git commit -m "feat(harvest): add anchor and score script"
```

---

### Task 9: Load Claims into Surveyor

**Files:**
- Create: `scripts/harvest/load-claims.ts`

**Step 1: Write the loader**

```typescript
// scripts/harvest/load-claims.ts
/**
 * Load anchored claims into Surveyor's context table.
 *
 * Usage: npx tsx scripts/harvest/load-claims.ts [--dry-run]
 *
 * Reads: scripts/harvest/data/anchored-claims.json
 * Writes to: Surveyor DB context table (adhoc/extract, importSource=context_harvester)
 */
import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const idx = line.indexOf("=");
  if (idx < 1 || line.trimStart().startsWith("#")) continue;
  process.env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/\r$/, "");
}

import { loadClaims } from "./lib/store";
import type { HarvestedClaim } from "./lib/types";

const DRY_RUN = process.argv.includes("--dry-run");

function renderEntityDoc(entityName: string, claims: HarvestedClaim[]): string {
  const parts: string[] = [];
  parts.push(`# Harvested Knowledge: ${entityName}\n`);
  parts.push(`> Auto-generated by Context Harvester on ${new Date().toISOString().slice(0, 10)}.`);
  parts.push(`> ${claims.length} claims from ${new Set(claims.map((c) => c.source)).size} sources.\n`);

  const agrees = claims.filter((c) => c.anchorStatus === "agrees");
  const related = claims.filter((c) => c.anchorStatus === "related");
  const unanchored = claims.filter((c) => c.anchorStatus === "unanchored");

  if (agrees.length > 0) {
    parts.push(`## Confirmed Mappings (agrees with SOT)\n`);
    for (const c of agrees) {
      const fieldLabel = c.fieldName || "Entity-level";
      parts.push(`- **${fieldLabel}**: ${c.claimText}`);
      parts.push(`  _[${c.sourceRef}]_\n`);
    }
  }

  if (related.length > 0) {
    parts.push(`## Related Context (not in SOT)\n`);
    for (const c of related) {
      const fieldLabel = c.fieldName || "Entity-level";
      parts.push(`- **${fieldLabel}**: ${c.claimText}`);
      parts.push(`  _[${c.sourceRef}]_\n`);
    }
  }

  if (unanchored.length > 0) {
    parts.push(`## Unanchored (no SOT mapping found)\n`);
    for (const c of unanchored) {
      const fieldLabel = c.fieldName || "Entity-level";
      parts.push(`- **${fieldLabel}**: ${c.claimText}`);
      parts.push(`  _[${c.sourceRef}]_\n`);
    }
  }

  return parts.join("\n").trim();
}

async function main() {
  const claims = loadClaims("anchored-claims.json");
  console.log(`Loaded ${claims.length} anchored claims`);

  if (claims.length === 0) {
    console.log("No claims to load. Run anchor-claims.ts first.");
    process.exit(0);
  }

  // Group by entity
  const byEntity = new Map<string, HarvestedClaim[]>();
  const noEntity: HarvestedClaim[] = [];

  for (const c of claims) {
    if (c.entityName) {
      if (!byEntity.has(c.entityName)) byEntity.set(c.entityName, []);
      byEntity.get(c.entityName)!.push(c);
    } else {
      noEntity.push(c);
    }
  }

  console.log(`${byEntity.size} entities with claims, ${noEntity.length} unresolved`);

  if (DRY_RUN) {
    for (const [entity, entityClaims] of byEntity) {
      console.log(`  ${entity}: ${entityClaims.length} claims`);
    }
    process.exit(0);
  }

  // Dynamic imports for Surveyor DB
  const { db } = await import("../../src/lib/db");
  const { context, entity } = await import("../../src/lib/db/schema");
  const { eq, and } = await import("drizzle-orm");
  const { estimateTokens } = await import("../../src/lib/llm/token-counter");

  // Resolve workspace ID
  const [firstEntity] = await db.select().from(entity).limit(1);
  if (!firstEntity) { console.error("No entities in DB"); process.exit(1); }
  const WORKSPACE_ID = firstEntity.workspaceId;

  // Resolve entity IDs
  const allEntities = await db
    .select({ id: entity.id, name: entity.name, displayName: entity.displayName })
    .from(entity)
    .where(eq(entity.side, "target"));

  const entityIdMap = new Map<string, string>();
  for (const e of allEntities) {
    entityIdMap.set(e.name, e.id);
    if (e.displayName) entityIdMap.set(e.displayName, e.id);
  }

  let created = 0;
  let updated = 0;

  for (const [entityName, entityClaims] of byEntity) {
    const content = renderEntityDoc(entityName, entityClaims);
    const tokenCount = estimateTokens(content);
    const name = `Harvested Knowledge > ${entityName}`;
    const entityId = entityIdMap.get(entityName) || null;
    const now = new Date().toISOString();

    const sourceCounts: Record<string, number> = {};
    for (const c of entityClaims) {
      sourceCounts[c.source] = (sourceCounts[c.source] || 0) + 1;
    }
    const avgConfidence = entityClaims.reduce((s, c) => s + c.confidence, 0) / entityClaims.length;

    // Check for existing harvested doc
    const existing = (await db
      .select()
      .from(context)
      .where(
        and(
          eq(context.workspaceId, WORKSPACE_ID),
          eq(context.name, name),
          eq(context.importSource, "context_harvester"),
        ),
      ))[0];

    if (existing) {
      await db.update(context)
        .set({
          content,
          tokenCount,
          isActive: true,
          metadata: { harvest_date: now, source_counts: sourceCounts, avg_confidence: avgConfidence },
          tags: ["harvested", entityName.toLowerCase(), ...new Set(entityClaims.map((c) => c.milestone.toLowerCase()))],
          updatedAt: now,
        })
        .where(eq(context.id, existing.id));
      updated++;
    } else {
      await db.insert(context).values({
        workspaceId: WORKSPACE_ID,
        name,
        category: "adhoc",
        subcategory: "extract",
        entityId,
        content,
        contentFormat: "markdown",
        tokenCount,
        tags: ["harvested", entityName.toLowerCase(), ...new Set(entityClaims.map((c) => c.milestone.toLowerCase()))],
        isActive: true,
        importSource: "context_harvester",
        metadata: { harvest_date: now, source_counts: sourceCounts, avg_confidence: avgConfidence },
      });
      created++;
    }

    console.log(`  ${entityName}: ${entityClaims.length} claims, ${tokenCount} tokens`);
  }

  console.log(`\nLoaded: ${created} created, ${updated} updated`);
  console.log(`Total entities with harvested context: ${byEntity.size}`);
}

main().catch(console.error);
```

**Step 2: Commit**

```bash
git add scripts/harvest/load-claims.ts
git commit -m "feat(harvest): add loader to write claims into Surveyor context"
```

---

### Task 10: Add `yaml` dependency and verify end-to-end

**Step 1: Check if `yaml` and `papaparse` are already in dependencies**

Run: `cd /Users/rob/code/surveyor && cat package.json | grep -E "yaml|papaparse"`

If `yaml` (the npm package for YAML parsing) is missing, install it:

Run: `cd /Users/rob/code/surveyor && npm install yaml`

If `papaparse` is already there (it's in the current deps as `@types/papaparse`), install the runtime too if needed:

Run: `cd /Users/rob/code/surveyor && npm install papaparse`

**Step 2: Verify SOT loader works**

Run: `cd /Users/rob/code/surveyor && npx tsx -e "const { loadSotMappings } = require('./scripts/harvest/lib/sot-loader'); const m = loadSotMappings('M1'); console.log('Entries:', m.size); const s = [...m.entries()].slice(0, 3); s.forEach(([k,v]) => console.log(k, '->', v.transform));"`

Expected: prints M1 mapping count and a few sample entries.

**Step 3: Verify Linear extraction (dry run)**

Run: `cd /Users/rob/code/surveyor && npx tsx scripts/harvest/extract-linear.ts --dry-run`

Expected: fetches MAP issues and prints count.

**Step 4: Commit any dependency changes**

```bash
git add package.json package-lock.json
git commit -m "chore: add yaml and papaparse dependencies for harvest scripts"
```

---

## Execution Order

1. **Task 1** — Shared types, Gestalt client, store
2. **Task 2** — Entity resolver
3. **Task 3** — SOT YAML loader
4. **Task 4** — LLM claim extractor
5. **Task 10** — Install dependencies, verify SOT loader + Linear dry run
6. **Task 5** — Google Sheets extraction (requires CSV download first)
7. **Task 6** — Slack extraction (requires Gestalt Slack connection first)
8. **Task 7** — Linear extraction
9. **Task 8** — Anchor & score
10. **Task 9** — Load into Surveyor

Tasks 5-7 (extraction) are independent and can run in parallel once Tasks 1-4 + 10 are done.

## Blockers

- **Slack not connected to Gestalt** — must connect at https://gestalt.peachstreet.dev/integrations before Task 6
- **Sheets tab API bug** — `get_values` escapes `!` in range params. Workaround: download CSVs manually for Task 5
- **Column indices** — M1/M2 tracker column positions (entity col, field col, population col, notes cols) need verification from actual CSV headers. Task 5 has placeholder indices that may need adjustment.
