# Feedback Trail Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Instrument the verdict → learning → Entity Knowledge → context → SOT eval pipeline with a `feedbackEvent` table and timeline UI so reviewers can verify feedback is captured and utilized.

**Architecture:** A new `feedback_event` SQLite table stores events emitted at each pipeline step. Events from the same verdict share a `correlationId`. A timeline component on the evaluation page groups and renders these events. One new API route serves events filtered by entity.

**Tech Stack:** SQLite/Drizzle, Next.js API routes, React, TanStack Query

---

### Task 1: Create migration script for feedback_event table

**Files:**
- Create: `scripts/migrate-feedback-event.ts`

**Step 1: Write the migration script**

```typescript
/**
 * Creates the feedback_event table. Idempotent — safe to run multiple times.
 *
 * Usage: npx tsx scripts/migrate-feedback-event.ts
 */

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.resolve(process.cwd(), "surveyor.db");
const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");

function tableExists(name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(name) as { name: string } | undefined;
  return !!row;
}

if (!tableExists("feedback_event")) {
  console.log("Creating feedback_event table...");
  db.exec(`
    CREATE TABLE feedback_event (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
      entity_id TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
      field_mapping_id TEXT REFERENCES field_mapping(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      correlation_id TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX idx_feedback_event_entity ON feedback_event(entity_id, created_at DESC);
    CREATE INDEX idx_feedback_event_correlation ON feedback_event(correlation_id);
  `);
  console.log("  feedback_event table created.");
} else {
  console.log("feedback_event table already exists.");
}

console.log("\nDone!");
db.close();
```

**Step 2: Run the migration**

Run: `cd /Users/rob/code/surveyor && npx tsx scripts/migrate-feedback-event.ts`
Expected: "feedback_event table created."

**Step 3: Commit**

```bash
git add scripts/migrate-feedback-event.ts
git commit -m "feat: add feedback_event migration script"
```

---

### Task 2: Add feedbackEvent to Drizzle schema

**Files:**
- Modify: `src/lib/db/schema.ts`

**Step 1: Add the table definition**

Add after the `sotEvaluation` table definition (search for `export const sotEvaluation`):

```typescript
// ─── Feedback Trail ──────────────────────────────────────────

export const feedbackEvent = sqliteTable(
  "feedback_event",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
    entityId: text("entity_id").notNull().references(() => entity.id, { onDelete: "cascade" }),
    fieldMappingId: text("field_mapping_id").references(() => fieldMapping.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    correlationId: text("correlation_id"),
    createdAt: text("created_at").notNull().default(nowDefault),
  },
  (table) => [
    index("idx_feedback_event_entity").on(table.entityId),
    index("idx_feedback_event_correlation").on(table.correlationId),
  ],
);
```

**Step 2: Verify the app compiles**

Run: `cd /Users/rob/code/surveyor && npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors related to feedbackEvent.

**Step 3: Commit**

```bash
git add src/lib/db/schema.ts
git commit -m "feat: add feedbackEvent table to Drizzle schema"
```

---

### Task 3: Create emitFeedbackEvent helper

**Files:**
- Create: `src/lib/feedback/emit-event.ts`

**Step 1: Write the helper**

```typescript
import { db } from "@/lib/db";
import { feedbackEvent } from "@/lib/db/schema";

export type FeedbackEventType =
  | "verdict_submitted"
  | "learning_created"
  | "entity_knowledge_rebuilt"
  | "context_assembled"
  | "sot_evaluated";

export function emitFeedbackEvent(input: {
  workspaceId: string;
  entityId: string;
  fieldMappingId?: string;
  eventType: FeedbackEventType;
  payload: Record<string, unknown>;
  correlationId?: string;
}): string {
  const [row] = db
    .insert(feedbackEvent)
    .values({
      workspaceId: input.workspaceId,
      entityId: input.entityId,
      fieldMappingId: input.fieldMappingId ?? null,
      eventType: input.eventType,
      payload: input.payload,
      correlationId: input.correlationId ?? null,
    })
    .returning({ id: feedbackEvent.id })
    .all();

  return row.id;
}
```

**Step 2: Verify it compiles**

Run: `cd /Users/rob/code/surveyor && npx tsc --noEmit 2>&1 | grep emit-event`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/lib/feedback/emit-event.ts
git commit -m "feat: add emitFeedbackEvent helper"
```

---

### Task 4: Emit verdict_submitted in verdict route

**Files:**
- Modify: `src/app/api/workspaces/[workspaceId]/mappings/[id]/verdict/route.ts`

**Step 1: Add event emission**

Add import at top:
```typescript
import { emitFeedbackEvent } from "@/lib/feedback/emit-event";
```

Replace the block from `const sourceVerdict =` through the `if (shouldExtract)` block (lines 44-52) with:

```typescript
    const sourceVerdict = "sourceVerdict" in body ? body.sourceVerdict : undefined;
    const transformVerdict = "transformVerdict" in body ? body.transformVerdict : undefined;
    const shouldExtract =
      (sourceVerdict && sourceVerdict !== "correct") ||
      (transformVerdict && transformVerdict !== "correct");

    // Load target field info for the event payload
    const mappingInfo = db
      .select({
        targetFieldName: field.name,
        sourceEntityName: entity.name,
      })
      .from(fieldMapping)
      .leftJoin(field, eq(fieldMapping.targetFieldId, field.id))
      .leftJoin(entity, eq(fieldMapping.sourceEntityId, entity.id))
      .where(eq(fieldMapping.id, id))
      .get();

    const targetField = mappingInfo
      ? db
          .select({ entityId: field.entityId })
          .from(field)
          .where(eq(field.id, db.select({ tfid: fieldMapping.targetFieldId }).from(fieldMapping).where(eq(fieldMapping.id, id)).get()!.tfid!))
          .get()
      : null;

    const correlationId = crypto.randomUUID();
    const entityId = targetField?.entityId;

    if (entityId) {
      emitFeedbackEvent({
        workspaceId,
        entityId,
        fieldMappingId: id,
        eventType: "verdict_submitted",
        payload: {
          sourceVerdict: body.sourceVerdict,
          sourceVerdictNotes: body.sourceVerdictNotes,
          transformVerdict: body.transformVerdict,
          transformVerdictNotes: body.transformVerdictNotes,
          fieldName: mappingInfo?.targetFieldName,
          sourceEntity: mappingInfo?.sourceEntityName,
        },
        correlationId,
      });
    }

    if (shouldExtract) {
      extractVerdictLearning(workspaceId, id, correlationId);
    }
```

Note: `extractVerdictLearning` signature changes in Task 5 to accept correlationId.

Also add `field, entity` to the schema import:
```typescript
import { fieldMapping, field, entity } from "@/lib/db/schema";
```

**Step 2: Verify it compiles** (will have a temporary type error until Task 5 — that's fine)

**Step 3: Commit** (defer to after Task 5 so both compile together)

---

### Task 5: Thread correlationId through extractVerdictLearning → rebuildEntityKnowledge

**Files:**
- Modify: `src/lib/generation/mapping-learning.ts`
- Modify: `src/lib/generation/entity-knowledge.ts`

**Step 1: Update extractVerdictLearning signature and emit learning_created**

In `mapping-learning.ts`, add import:
```typescript
import { emitFeedbackEvent } from "@/lib/feedback/emit-event";
```

Change the function signature (line 254):
```typescript
export function extractVerdictLearning(
  workspaceId: string,
  fieldMappingId: string,
  correlationId?: string,
): void {
```

After the `for (const lv of learningValues)` loop that inserts learnings (after line 341), add before the `rebuildEntityKnowledge` call:

```typescript
  for (const lv of learningValues) {
    const learningId = crypto.randomUUID();
    db.insert(learning).values({
      id: learningId,
      workspaceId,
      entityId: targetInfo.entityId,
      fieldName: lv.fieldName,
      scope: "field",
      source: "review",
      content: lv.content,
    }).run();

    emitFeedbackEvent({
      workspaceId,
      entityId: targetInfo.entityId,
      fieldMappingId,
      eventType: "learning_created",
      payload: { learningId, scope: "field", content: lv.content, fieldName: lv.fieldName },
      correlationId,
    });
  }
```

(This replaces the existing for loop — the only change is generating `learningId` above the insert and adding the `emitFeedbackEvent` call.)

Change the `rebuildEntityKnowledge` call (line 343):
```typescript
  rebuildEntityKnowledge(workspaceId, targetInfo.entityId, correlationId);
```

**Step 2: Update rebuildEntityKnowledge signature and emit entity_knowledge_rebuilt**

In `entity-knowledge.ts`, add import:
```typescript
import { emitFeedbackEvent } from "@/lib/feedback/emit-event";
```

Change the function signature (line 48):
```typescript
export function rebuildEntityKnowledge(
  workspaceId: string,
  entityId: string,
  correlationId?: string,
): { contextId: string; created: boolean } | null {
```

After the `upsertContext` call and before `linkToMatchingSkills` (after line 172), add:

```typescript
  // Count corrections for event payload
  const corrections = learnings.filter((l) => l.source === "review");
  const snippets = corrections.slice(0, 5).map((c) => c.content.slice(0, 120));

  emitFeedbackEvent({
    workspaceId,
    entityId,
    eventType: "entity_knowledge_rebuilt",
    payload: {
      contextId,
      sectionCount: [corrections.length > 0, training.length > 0, questions.length > 0, threadDecisions.length > 0].filter(Boolean).length,
      totalTokens: estimateTokens(content),
      correctionCount: corrections.length,
      snippets,
    },
    correlationId,
  });
```

Note: `training` is a local variable already defined in `renderDocument` — but `rebuildEntityKnowledge` doesn't have it. Instead, compute inline:

```typescript
  const correctionLearnings = learnings.filter((l) => l.source === "review");
  const trainingLearnings = learnings.filter((l) => l.source === "training");
  const snippets = correctionLearnings.slice(0, 5).map((c) => c.content.slice(0, 120));

  emitFeedbackEvent({
    workspaceId,
    entityId,
    eventType: "entity_knowledge_rebuilt",
    payload: {
      contextId,
      sectionCount: [
        correctionLearnings.length > 0,
        trainingLearnings.length > 0,
        questions.length > 0,
        threadDecisions.length > 0,
      ].filter(Boolean).length,
      totalTokens: estimateTokens(content),
      correctionCount: correctionLearnings.length,
      snippets,
    },
    correlationId,
  });
```

**Step 3: Verify it compiles**

Run: `cd /Users/rob/code/surveyor && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

**Step 4: Commit (Tasks 4 + 5 together)**

```bash
git add src/app/api/workspaces/[workspaceId]/mappings/[id]/verdict/route.ts src/lib/generation/mapping-learning.ts src/lib/generation/entity-knowledge.ts
git commit -m "feat: emit feedback events for verdict → learning → EK chain"
```

---

### Task 6: Emit context_assembled in context-assembler

**Files:**
- Modify: `src/lib/generation/context-assembler.ts`

**Step 1: Add event emission after Entity Knowledge lookup**

Add import:
```typescript
import { emitFeedbackEvent } from "@/lib/feedback/emit-event";
```

After the Entity Knowledge direct inclusion block (after line 187, where `referenceContexts.push` for EK docs ends), add:

```typescript
    // Emit feedback event for context assembly tracing
    const ekTokens = ekDocs.reduce((sum, doc) => {
      if (seenContextIds.has(doc.id)) return sum; // already counted above, skip dupes
      return sum + (doc.tokenCount || estimateTokens(doc.content || ""));
    }, 0);
```

Wait — `ekDocs` is iterated above and `seenContextIds` is modified. We need to track EK inclusion during the loop. Better approach: track EK stats inline:

After the `if (entityId) {` block (line 167-187), the ekDocs are already pushed to referenceContexts. Add right after that block closes:

```typescript
  // Track Entity Knowledge inclusion for feedback trail
  let ekIncluded = false;
  let ekTokenCount = 0;

  if (entityId) {
    const ekDocs = db
      .select()
      .from(context)
      // ... (existing query — don't duplicate)
```

Actually, simplest approach: just track during the existing loop. After the `for (const doc of ekDocs)` loop, add:

```typescript
    const ekIncludedCount = ekDocs.filter(d => !seenContextIds.has(d.id) || referenceContexts.some(r => r.id === d.id)).length;
```

This is getting convoluted. Cleanest approach — emit AFTER the full assembly is done, right before the return (around line 332). At that point we know everything:

```typescript
  // Emit context_assembled event for feedback trail
  if (entityId) {
    const ekContexts = referenceContexts.filter(
      (c) => c.name.startsWith("Entity Knowledge >")
    );
    emitFeedbackEvent({
      workspaceId,
      entityId,
      eventType: "context_assembled",
      payload: {
        entityKnowledgeIncluded: ekContexts.length > 0,
        ekTokens: ekContexts.reduce((sum, c) => sum + c.tokenCount, 0),
        totalContextTokens: totalTokens,
        skillCount: skillsUsed.length,
      },
    });
  }
```

Place this just before the `setCachedContext` call and the return statement.

**Step 2: Verify it compiles**

Run: `cd /Users/rob/code/surveyor && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/lib/generation/context-assembler.ts
git commit -m "feat: emit context_assembled feedback event"
```

---

### Task 7: Emit sot_evaluated in SOT evaluation route

**Files:**
- Modify: `src/app/api/workspaces/[workspaceId]/evaluations/sot/route.ts`

**Step 1: Add event emission after each successful evaluation**

Add import:
```typescript
import { emitFeedbackEvent } from "@/lib/feedback/emit-event";
```

Inside the POST handler, after `db.insert(sotEvaluation)...run()` (after line 172) and before the `results.push` (line 174), add:

```typescript
      // Look up previous eval for delta calculation
      const previousEval = db
        .select({ sourceExactPct: sotEvaluation.sourceExactPct })
        .from(sotEvaluation)
        .where(
          and(
            eq(sotEvaluation.workspaceId, workspaceId),
            eq(sotEvaluation.entityId, te.id),
            sql`${sotEvaluation.id} != ${evalId}`,
          )
        )
        .orderBy(desc(sotEvaluation.createdAt))
        .limit(1)
        .get();

      emitFeedbackEvent({
        workspaceId,
        entityId: te.id,
        eventType: "sot_evaluated",
        payload: {
          evaluationId: evalId,
          sourceExactPct: evalResult.sourceExactPct,
          sourceLenientPct: evalResult.sourceLenientPct,
          scoredFields: evalResult.scoredFields,
          sourceExactCount: evalResult.sourceExactCount,
          deltaFromPrevious: previousEval
            ? Math.round((evalResult.sourceExactPct - previousEval.sourceExactPct) * 10) / 10
            : null,
        },
      });
```

**Step 2: Verify it compiles**

Run: `cd /Users/rob/code/surveyor && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/app/api/workspaces/[workspaceId]/evaluations/sot/route.ts
git commit -m "feat: emit sot_evaluated feedback event with delta"
```

---

### Task 8: Create feedback events API route

**Files:**
- Create: `src/app/api/workspaces/[workspaceId]/feedback-events/route.ts`

**Step 1: Write the route**

```typescript
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { feedbackEvent } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";

export const GET = withAuth(async (req, ctx, { workspaceId }) => {
  const url = new URL(req.url);
  const entityId = url.searchParams.get("entityId");

  if (!entityId) {
    return NextResponse.json({ error: "entityId required" }, { status: 400 });
  }

  const events = db
    .select()
    .from(feedbackEvent)
    .where(
      and(
        eq(feedbackEvent.workspaceId, workspaceId),
        eq(feedbackEvent.entityId, entityId),
      )
    )
    .orderBy(desc(feedbackEvent.createdAt))
    .limit(200)
    .all();

  return NextResponse.json({ events });
});
```

**Step 2: Verify it compiles**

Run: `cd /Users/rob/code/surveyor && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/app/api/workspaces/[workspaceId]/feedback-events/route.ts
git commit -m "feat: add feedback events GET API route"
```

---

### Task 9: Create React Query hook for feedback events

**Files:**
- Create: `src/queries/feedback-event-queries.ts`

**Step 1: Write the hook**

```typescript
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@/lib/hooks/use-workspace-id";

export interface FeedbackEvent {
  id: string;
  workspaceId: string;
  entityId: string;
  fieldMappingId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  correlationId: string | null;
  createdAt: string;
}

export function useFeedbackEvents(entityId: string | null) {
  const workspaceId = useWorkspaceId();

  return useQuery({
    queryKey: ["feedback-events", workspaceId, entityId],
    queryFn: async () => {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/feedback-events?entityId=${entityId}`
      );
      if (!res.ok) throw new Error("Failed to load feedback events");
      const data = await res.json();
      return data.events as FeedbackEvent[];
    },
    enabled: !!entityId && !!workspaceId,
  });
}
```

Note: Check if `useWorkspaceId` exists — if not, extract from the pattern used in other query files (e.g., `sot-evaluation-queries.ts`). Adapt the import accordingly.

**Step 2: Verify it compiles**

Run: `cd /Users/rob/code/surveyor && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/queries/feedback-event-queries.ts
git commit -m "feat: add useFeedbackEvents React Query hook"
```

---

### Task 10: Build FeedbackTrail UI component

**Files:**
- Create: `src/components/evaluation/feedback-trail.tsx`

**Step 1: Write the component**

```tsx
"use client";

import { useFeedbackEvents, type FeedbackEvent } from "@/queries/feedback-event-queries";
import { cn } from "@/lib/utils";

interface Props {
  entityId: string;
}

/** Group events by correlationId, then by 5-second time windows for uncorrelated events. */
function groupEvents(events: FeedbackEvent[]): FeedbackEvent[][] {
  const groups: FeedbackEvent[][] = [];
  const byCorrelation = new Map<string, FeedbackEvent[]>();
  const uncorrelated: FeedbackEvent[] = [];

  for (const event of events) {
    if (event.correlationId) {
      const group = byCorrelation.get(event.correlationId) ?? [];
      group.push(event);
      byCorrelation.set(event.correlationId, group);
    } else {
      uncorrelated.push(event);
    }
  }

  // Add correlated groups
  for (const group of byCorrelation.values()) {
    groups.push(group.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  }

  // Group uncorrelated by 5-second windows
  let currentGroup: FeedbackEvent[] = [];
  for (const event of uncorrelated) {
    if (
      currentGroup.length === 0 ||
      Math.abs(
        new Date(event.createdAt).getTime() -
          new Date(currentGroup[0].createdAt).getTime()
      ) < 5000
    ) {
      currentGroup.push(event);
    } else {
      groups.push(currentGroup);
      currentGroup = [event];
    }
  }
  if (currentGroup.length > 0) groups.push(currentGroup);

  // Sort groups by earliest event timestamp, descending
  groups.sort((a, b) => b[0].createdAt.localeCompare(a[0].createdAt));

  return groups;
}

const EVENT_LABELS: Record<string, { label: string; color: string }> = {
  verdict_submitted: { label: "Verdict", color: "text-amber-600 bg-amber-50 border-amber-200" },
  learning_created: { label: "Learning Created", color: "text-blue-600 bg-blue-50 border-blue-200" },
  entity_knowledge_rebuilt: { label: "Entity Knowledge Rebuilt", color: "text-purple-600 bg-purple-50 border-purple-200" },
  context_assembled: { label: "Context Assembled", color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  sot_evaluated: { label: "SOT Evaluated", color: "text-rose-600 bg-rose-50 border-rose-200" },
};

function EventCard({ event }: { event: FeedbackEvent }) {
  const meta = EVENT_LABELS[event.eventType] ?? { label: event.eventType, color: "text-gray-600 bg-gray-50 border-gray-200" };
  const payload = event.payload;
  const time = new Date(event.createdAt).toLocaleTimeString();

  return (
    <div className={cn("border rounded-md px-3 py-2 text-xs", meta.color)}>
      <div className="flex items-center justify-between mb-1">
        <span className="font-semibold">{meta.label}</span>
        <span className="text-[10px] opacity-70">{time}</span>
      </div>
      <EventPayload eventType={event.eventType} payload={payload} />
    </div>
  );
}

function EventPayload({ eventType, payload }: { eventType: string; payload: Record<string, unknown> }) {
  switch (eventType) {
    case "verdict_submitted": {
      const p = payload as { fieldName?: string; sourceVerdict?: string; sourceEntity?: string; sourceVerdictNotes?: string; transformVerdict?: string };
      return (
        <div className="space-y-0.5">
          <div>Field: <span className="font-mono">{p.fieldName}</span></div>
          {p.sourceVerdict && <div>Source: <span className="font-semibold">{p.sourceVerdict}</span>{p.sourceEntity ? ` (was: ${p.sourceEntity})` : ""}</div>}
          {p.sourceVerdictNotes && <div className="italic">"{p.sourceVerdictNotes}"</div>}
          {p.transformVerdict && <div>Transform: <span className="font-semibold">{p.transformVerdict}</span></div>}
        </div>
      );
    }
    case "learning_created": {
      const p = payload as { content?: string; fieldName?: string };
      return (
        <div>
          <div className="font-mono">{p.fieldName}</div>
          <div className="mt-0.5 opacity-80 line-clamp-2">{p.content}</div>
        </div>
      );
    }
    case "entity_knowledge_rebuilt": {
      const p = payload as { correctionCount?: number; totalTokens?: number; sectionCount?: number; snippets?: string[] };
      return (
        <div className="space-y-0.5">
          <div>{p.correctionCount} correction{p.correctionCount !== 1 ? "s" : ""}, {p.totalTokens?.toLocaleString()} tokens, {p.sectionCount} section{p.sectionCount !== 1 ? "s" : ""}</div>
          {p.snippets?.map((s, i) => (
            <div key={i} className="opacity-70 line-clamp-1 font-mono text-[10px]">{s}</div>
          ))}
        </div>
      );
    }
    case "context_assembled": {
      const p = payload as { entityKnowledgeIncluded?: boolean; ekTokens?: number; totalContextTokens?: number; skillCount?: number };
      return (
        <div className="space-y-0.5">
          <div>Entity Knowledge: {p.entityKnowledgeIncluded ? `included (${p.ekTokens?.toLocaleString()}t)` : "not found"}</div>
          <div>Total: {p.skillCount} skills, {p.totalContextTokens?.toLocaleString()}t context</div>
        </div>
      );
    }
    case "sot_evaluated": {
      const p = payload as { sourceExactPct?: number; sourceLenientPct?: number; scoredFields?: number; sourceExactCount?: number; deltaFromPrevious?: number | null };
      const delta = p.deltaFromPrevious;
      return (
        <div className="space-y-0.5">
          <div>
            Exact: {p.sourceExactPct}% ({p.sourceExactCount}/{p.scoredFields})
            {delta != null && (
              <span className={cn("ml-1 font-semibold", delta > 0 ? "text-green-700" : delta < 0 ? "text-red-700" : "")}>
                {delta > 0 ? "+" : ""}{delta}%
              </span>
            )}
          </div>
          <div>Lenient: {p.sourceLenientPct}%</div>
        </div>
      );
    }
    default:
      return <pre className="text-[10px] whitespace-pre-wrap">{JSON.stringify(payload, null, 2)}</pre>;
  }
}

export function FeedbackTrail({ entityId }: Props) {
  const { data: events, isLoading } = useFeedbackEvents(entityId);

  if (isLoading) {
    return <div className="animate-pulse h-20 bg-muted rounded-lg" />;
  }

  if (!events || events.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-4 text-center">
        No feedback events yet for this entity. Give a verdict in the discuss view to start the trail.
      </div>
    );
  }

  const groups = groupEvents(events);

  return (
    <div className="space-y-3">
      {groups.map((group, gi) => (
        <div key={gi} className="relative pl-4 border-l-2 border-muted-foreground/20">
          <div className="space-y-1.5">
            {group.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

**Step 2: Verify it compiles**

Run: `cd /Users/rob/code/surveyor && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/components/evaluation/feedback-trail.tsx
git commit -m "feat: add FeedbackTrail timeline component"
```

---

### Task 11: Integrate FeedbackTrail into evaluation page

**Files:**
- Modify: `src/app/evaluation/evaluation-client.tsx`

**Step 1: Add import**

```typescript
import { FeedbackTrail } from "@/components/evaluation/feedback-trail";
```

**Step 2: Add state for selected entity**

The page already has `selectedEvalId`. We need to resolve the entityId from the selected evaluation. Find the entity row when selected:

After the detail panel section (after line 179, before the closing `</div>`), add:

```tsx
      {/* Feedback Trail */}
      {selectedEvalId && detail && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">
            Feedback Trail
          </h2>
          <p className="text-sm text-muted-foreground">
            Pipeline events showing how reviewer feedback flows through learning extraction, Entity Knowledge rebuilds, context assembly, and SOT evaluation.
          </p>
          <FeedbackTrail entityId={detail.entityId} />
        </div>
      )}
```

Note: `detail` should already have `entityId` from the evaluation detail query. Verify that `useSotEvaluationDetail` returns it — check `sot-evaluation-queries.ts`. If `detail.entityId` is not available, use `latestByEntity` to look it up from the `selectedEvalId`:

```typescript
const selectedEntity = selectedEvalId
  ? evaluations.find((e) => e.id === selectedEvalId)
  : null;
```

Then use `selectedEntity?.entityId` instead of `detail.entityId`.

**Step 3: Verify it compiles and renders**

Run: `cd /Users/rob/code/surveyor && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

**Step 4: Commit**

```bash
git add src/app/evaluation/evaluation-client.tsx
git commit -m "feat: integrate FeedbackTrail into evaluation page"
```

---

### Task 12: Manual end-to-end verification

**Step 1: Start the dev server**

Run: `cd /Users/rob/code/surveyor && npm run dev`

**Step 2: Give a verdict**

1. Open http://localhost:3000
2. Navigate to a field in the discuss view for `loss_mitigation_loan_modification`
3. Set a source verdict to `wrong_table` with notes
4. Check the server console for any errors

**Step 3: Check feedback events in DB**

Run: `cd /Users/rob/code/surveyor && sqlite3 surveyor.db "SELECT event_type, json_extract(payload, '$.fieldName'), correlation_id, created_at FROM feedback_event ORDER BY created_at DESC LIMIT 10;"`

Expected: 3 rows with the same `correlation_id` — `verdict_submitted`, `learning_created`, `entity_knowledge_rebuilt`.

**Step 4: Run SOT evaluation**

1. Go to http://localhost:3000/evaluation
2. Click "Run Evaluation"
3. Click on the entity row to expand
4. Scroll down — the Feedback Trail section should show the grouped timeline

**Step 5: Verify the trail**

Confirm the timeline shows:
- The verdict group (3 connected events)
- The SOT evaluation (standalone event, possibly with delta)

**Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix: feedback trail adjustments from manual testing"
```
