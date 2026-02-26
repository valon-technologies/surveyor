# Feedback Interface Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add three structured feedback cards (Source Verdict, Transform Verdict, Question Quality) to the discuss page right sidebar so reviewer decisions flow into Entity Knowledge and improve future generations.

**Architecture:** Verdict fields are stored as nullable annotations on the current `field_mapping` version (no copy-on-write). Non-correct verdicts trigger a new `extractVerdictLearning()` path that creates `learning` records and calls the existing `rebuildEntityKnowledge()` — the same fast-loop path already verified to work. Three new React components live in `src/components/review/` and are added to the discuss page sidebar.

**Tech Stack:** Next.js 15, SQLite + Drizzle ORM, React Query, TypeScript, Tailwind / shadcn-style UI components

---

## Task 1: Add verdict columns to the DB schema

**Files:**
- Modify: `src/lib/db/schema.ts`

### Step 1: Add 4 verdict columns to `fieldMapping` table

In `src/lib/db/schema.ts`, find the `fieldMapping` table definition. After the `excludeReason` column, add:

```typescript
    // Reviewer feedback verdicts (annotations — do not trigger copy-on-write)
    sourceVerdict: text("source_verdict"),
    // correct | wrong_table | wrong_field | should_be_unmapped | missing_source
    sourceVerdictNotes: text("source_verdict_notes"),
    transformVerdict: text("transform_verdict"),
    // correct | not_needed | needed_but_missing | wrong_enum | wrong_logic
    transformVerdictNotes: text("transform_verdict_notes"),
```

### Step 2: Add 3 question feedback columns to `question` table

In the `question` table definition, after the existing `chatSessionId` column, add:

```typescript
    // Reviewer feedback on auto-generated questions
    feedbackHelpful: integer("feedback_helpful", { mode: "boolean" }),
    feedbackWhyNot: text("feedback_why_not"),
    // too_vague | wrong_thing | already_answered | not_needed
    feedbackBetterQuestion: text("feedback_better_question"),
```

### Step 3: Push schema to DB

```bash
cd /Users/rob/code/surveyor
npm run db:push
```

Expected: No errors. SQLite adds nullable columns to existing tables without data migration.

### Step 4: Verify columns exist

```bash
sqlite3 /Users/rob/code/surveyor/surveyor.db ".schema field_mapping" | grep verdict
sqlite3 /Users/rob/code/surveyor/surveyor.db ".schema question" | grep feedback
```

Expected output:
```
"source_verdict" text,
"source_verdict_notes" text,
"transform_verdict" text,
"transform_verdict_notes" text,
"feedback_helpful" integer,
"feedback_why_not" text,
"feedback_better_question" text,
```

### Step 5: Commit

```bash
cd /Users/rob/code/surveyor
git add src/lib/db/schema.ts
git commit -m "feat: add verdict and question feedback columns to schema"
```

---

## Task 2: Extend mapping-learning.ts with verdict extraction

**Files:**
- Modify: `src/lib/generation/mapping-learning.ts`

This adds a new exported function `extractVerdictLearning` that creates learning records from verdict feedback, then rebuilds Entity Knowledge.

### Step 1: Add the function

At the bottom of `src/lib/generation/mapping-learning.ts`, add:

```typescript
/**
 * Create learning records from reviewer verdict feedback.
 * Called when a non-'correct' source or transform verdict is saved.
 * Triggers rebuildEntityKnowledge so the next generation sees the feedback.
 */
export function extractVerdictLearning(
  workspaceId: string,
  fieldMappingId: string,
): void {
  // Load the mapping + field + entity names
  const mapping = db
    .select({
      id: fieldMapping.id,
      sourceVerdict: fieldMapping.sourceVerdict,
      sourceVerdictNotes: fieldMapping.sourceVerdictNotes,
      transformVerdict: fieldMapping.transformVerdict,
      transformVerdictNotes: fieldMapping.transformVerdictNotes,
      sourceEntityName: entity.name,
      sourceFieldName: field.name,
    })
    .from(fieldMapping)
    .leftJoin(entity, eq(fieldMapping.sourceEntityId, entity.id))
    .leftJoin(field, eq(fieldMapping.sourceFieldId, field.id))
    .where(eq(fieldMapping.id, fieldMappingId))
    .get();

  if (!mapping) return;

  // Load target field + entity
  const targetInfo = db
    .select({
      fieldName: field.name,
      entityId: field.entityId,
      entityName: entity.name,
    })
    .from(fieldMapping)
    .innerJoin(field, eq(fieldMapping.targetFieldId, field.id))
    .innerJoin(entity, eq(field.entityId, entity.id))
    .where(eq(fieldMapping.id, fieldMappingId))
    .get();

  if (!targetInfo) return;

  const prefix = `For ${targetInfo.entityName}.${targetInfo.fieldName}`;
  const learningValues: Array<{ content: string; fieldName: string }> = [];

  // Source verdict → learning
  if (mapping.sourceVerdict && mapping.sourceVerdict !== "correct") {
    const notes = mapping.sourceVerdictNotes ? ` Notes: ${mapping.sourceVerdictNotes}` : "";
    const currentSrc = mapping.sourceEntityName && mapping.sourceFieldName
      ? `${mapping.sourceEntityName}.${mapping.sourceFieldName}`
      : mapping.sourceEntityName || "unknown";

    const contentMap: Record<string, string> = {
      wrong_table: `${prefix}: Source table is wrong. Model used ${currentSrc}.${notes}`,
      wrong_field: `${prefix}: Source field is wrong within ${mapping.sourceEntityName || "the entity"}.${notes}`,
      should_be_unmapped: `${prefix}: This field has no source. Do NOT attempt to map it — leave unmapped.`,
      missing_source: `${prefix}: This field has a source but was left unmapped.${notes}`,
    };

    const content = contentMap[mapping.sourceVerdict];
    if (content) learningValues.push({ content, fieldName: targetInfo.fieldName });
  }

  // Transform verdict → learning
  if (mapping.transformVerdict && mapping.transformVerdict !== "correct") {
    const notes = mapping.transformVerdictNotes ? ` Notes: ${mapping.transformVerdictNotes}` : "";

    const contentMap: Record<string, string> = {
      not_needed: `${prefix}: No transform required — map directly.`,
      needed_but_missing: `${prefix}: A transform is required.${notes}`,
      wrong_enum: `${prefix}: Enum mapping is incorrect.${notes}`,
      wrong_logic: `${prefix}: Transform logic is wrong.${notes}`,
    };

    const content = contentMap[mapping.transformVerdict];
    if (content) learningValues.push({ content, fieldName: targetInfo.fieldName });
  }

  if (learningValues.length === 0) return;

  for (const lv of learningValues) {
    db.insert(learning).values({
      id: crypto.randomUUID(),
      workspaceId,
      entityId: targetInfo.entityId,
      fieldName: lv.fieldName,
      scope: "field",
      source: "review",
      content: lv.content,
    }).run();
  }

  rebuildEntityKnowledge(workspaceId, targetInfo.entityId);
  emitSignal(workspaceId, targetInfo.entityId, "mapping_correction");
}
```

### Step 2: Verify the imports are present

Check that `mapping-learning.ts` already imports `learning`, `entity`, `field`, `fieldMapping` from schema, and `rebuildEntityKnowledge`, `emitSignal`. Add any missing imports at the top.

### Step 3: Build check

```bash
cd /Users/rob/code/surveyor
npx tsc --noEmit 2>&1 | grep mapping-learning
```

Expected: No errors from mapping-learning.ts.

### Step 4: Commit

```bash
git add src/lib/generation/mapping-learning.ts
git commit -m "feat: add extractVerdictLearning for structured feedback-to-context loop"
```

---

## Task 3: Verdict API route for field mappings

**Files:**
- Create: `src/app/api/workspaces/[workspaceId]/mappings/[id]/verdict/route.ts`

### Step 1: Create the route file

```typescript
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { fieldMapping } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { extractVerdictLearning } from "@/lib/generation/mapping-learning";

export const PATCH = withAuth(
  async (req, ctx, { workspaceId }) => {
    const id = ctx.params.id as string;
    const body = await req.json() as {
      sourceVerdict?: string;
      sourceVerdictNotes?: string;
      transformVerdict?: string;
      transformVerdictNotes?: string;
    };

    // Verify mapping belongs to workspace
    const existing = db
      .select({ id: fieldMapping.id })
      .from(fieldMapping)
      .where(and(eq(fieldMapping.id, id), eq(fieldMapping.workspaceId, workspaceId)))
      .get();

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Build update object — only include provided keys
    const updates: Record<string, string | null> = {};
    if ("sourceVerdict" in body) updates.sourceVerdict = body.sourceVerdict ?? null;
    if ("sourceVerdictNotes" in body) updates.sourceVerdictNotes = body.sourceVerdictNotes ?? null;
    if ("transformVerdict" in body) updates.transformVerdict = body.transformVerdict ?? null;
    if ("transformVerdictNotes" in body) updates.transformVerdictNotes = body.transformVerdictNotes ?? null;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    db.update(fieldMapping)
      .set({ ...updates, updatedAt: new Date().toISOString() })
      .where(eq(fieldMapping.id, id))
      .run();

    // If any verdict is non-correct, extract learnings and rebuild Entity Knowledge
    const sourceVerdict = "sourceVerdict" in body ? body.sourceVerdict : undefined;
    const transformVerdict = "transformVerdict" in body ? body.transformVerdict : undefined;
    const shouldExtract =
      (sourceVerdict && sourceVerdict !== "correct") ||
      (transformVerdict && transformVerdict !== "correct");

    if (shouldExtract) {
      extractVerdictLearning(workspaceId, id);
    }

    return NextResponse.json({ success: true });
  },
  { requiredRole: "editor" }
);
```

### Step 2: Test with curl

```bash
# Get a field mapping ID first
sqlite3 /Users/rob/code/surveyor/surveyor.db "SELECT id FROM field_mapping WHERE workspace_id='2ac4e497-1c82-4b0d-a86e-83bec30761c8' AND status='unreviewed' LIMIT 1;"
```

Then test via the UI (curl requires session auth — easier to verify via UI in Task 9).

### Step 3: Build check

```bash
cd /Users/rob/code/surveyor
npx tsc --noEmit 2>&1 | grep verdict
```

Expected: No errors.

### Step 4: Commit

```bash
git add src/app/api/workspaces/[workspaceId]/mappings/[id]/verdict/route.ts
git commit -m "feat: add PATCH /mappings/[id]/verdict API route"
```

---

## Task 4: Question feedback API route

**Files:**
- Create: `src/app/api/workspaces/[workspaceId]/questions/[id]/feedback/route.ts`

### Step 1: Check if the questions route directory exists

```bash
ls /Users/rob/code/surveyor/src/app/api/workspaces/[workspaceId]/questions/
```

If a `[id]` subdirectory doesn't exist, create it.

### Step 2: Create the route file

```typescript
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { question, learning, fieldMapping, field, entity } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { rebuildEntityKnowledge } from "@/lib/generation/entity-knowledge";

export const PATCH = withAuth(
  async (req, ctx, { workspaceId }) => {
    const id = ctx.params.id as string;
    const body = await req.json() as {
      feedbackHelpful?: boolean;
      feedbackWhyNot?: string;
      feedbackBetterQuestion?: string;
    };

    const existing = db
      .select({ id: question.id, fieldMappingId: question.fieldMappingId, entityId: question.entityId })
      .from(question)
      .where(and(eq(question.id, id), eq(question.workspaceId, workspaceId)))
      .get();

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const updates: Record<string, unknown> = {};
    if ("feedbackHelpful" in body) updates.feedbackHelpful = body.feedbackHelpful ? 1 : 0;
    if ("feedbackWhyNot" in body) updates.feedbackWhyNot = body.feedbackWhyNot ?? null;
    if ("feedbackBetterQuestion" in body) updates.feedbackBetterQuestion = body.feedbackBetterQuestion ?? null;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    db.update(question)
      .set({ ...updates, updatedAt: new Date().toISOString() })
      .where(eq(question.id, id))
      .run();

    // If not helpful and a better question was provided, add to Entity Knowledge
    const betterQ = body.feedbackBetterQuestion?.trim();
    if (body.feedbackHelpful === false && betterQ) {
      // Resolve entityId from the linked field mapping if needed
      let entityId = existing.entityId;
      if (!entityId && existing.fieldMappingId) {
        const fmInfo = db
          .select({ entityId: entity.id })
          .from(fieldMapping)
          .innerJoin(field, eq(fieldMapping.targetFieldId, field.id))
          .innerJoin(entity, eq(field.entityId, entity.id))
          .where(eq(fieldMapping.id, existing.fieldMappingId))
          .get();
        entityId = fmInfo?.entityId ?? null;
      }

      if (entityId) {
        db.insert(learning).values({
          id: crypto.randomUUID(),
          workspaceId,
          entityId,
          scope: "entity",
          source: "review",
          content: `Open question (improved): ${betterQ}`,
        }).run();

        rebuildEntityKnowledge(workspaceId, entityId);
      }
    }

    return NextResponse.json({ success: true });
  },
  { requiredRole: "editor" }
);
```

### Step 3: Build check

```bash
cd /Users/rob/code/surveyor
npx tsc --noEmit 2>&1 | grep "questions.*feedback\|feedback.*question"
```

Expected: No errors.

### Step 4: Commit

```bash
git add src/app/api/workspaces/[workspaceId]/questions/[id]/feedback/route.ts
git commit -m "feat: add PATCH /questions/[id]/feedback API route"
```

---

## Task 5: React Query hooks

**Files:**
- Modify: `src/queries/mapping-queries.ts`
- Modify: `src/queries/question-queries.ts` (or wherever question queries live)

### Step 1: Add `useUpdateMappingVerdict` to mapping-queries.ts

Find `mapping-queries.ts`. After the existing mutation hooks, add:

```typescript
export function useUpdateMappingVerdict() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "mappings");
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      sourceVerdict?: string;
      sourceVerdictNotes?: string;
      transformVerdict?: string;
      transformVerdictNotes?: string;
    }) => api.patch(`${basePath}/${id}/verdict`, data),
  });
}
```

No cache invalidation needed — verdicts are annotations that don't affect the review queue display.

### Step 2: Add `useUpdateQuestionFeedback` to question-queries.ts

Find the question queries file (check `src/queries/question-queries.ts`). Add:

```typescript
export function useUpdateQuestionFeedback() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "questions");
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      feedbackHelpful?: boolean;
      feedbackWhyNot?: string;
      feedbackBetterQuestion?: string;
    }) => api.patch(`${basePath}/${id}/feedback`, data),
  });
}
```

### Step 3: Build check

```bash
cd /Users/rob/code/surveyor
npx tsc --noEmit 2>&1 | grep "queries"
```

Expected: No errors.

### Step 4: Commit

```bash
git add src/queries/mapping-queries.ts src/queries/question-queries.ts
git commit -m "feat: add useUpdateMappingVerdict and useUpdateQuestionFeedback hooks"
```

---

## Task 6: SourceVerdictCard component

**Files:**
- Create: `src/components/review/source-verdict-card.tsx`

This card is always shown. It displays the current source entity + field and lets the reviewer give a verdict.

### Step 1: Create the component

```typescript
"use client";

import { useState, useEffect } from "react";
import { ChevronDown, ChevronRight, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUpdateMappingVerdict } from "@/queries/mapping-queries";

const SOURCE_VERDICT_OPTIONS = [
  { value: "correct", label: "Correct" },
  { value: "wrong_table", label: "Wrong table (right field, wrong entity)" },
  { value: "wrong_field", label: "Wrong field (right table, wrong column)" },
  { value: "should_be_unmapped", label: "Should be unmapped — no source exists" },
  { value: "missing_source", label: "Missing source — field exists but wasn't mapped" },
] as const;

interface SourceVerdictCardProps {
  mappingId: string;
  sourceEntityName: string | null;
  sourceFieldName: string | null;
  initialVerdict?: string | null;
  initialNotes?: string | null;
}

export function SourceVerdictCard({
  mappingId,
  sourceEntityName,
  sourceFieldName,
  initialVerdict,
  initialNotes,
}: SourceVerdictCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [verdict, setVerdict] = useState(initialVerdict ?? "");
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const mutation = useUpdateMappingVerdict();

  const sourceLabel = sourceEntityName && sourceFieldName
    ? `${sourceEntityName}.${sourceFieldName}`
    : sourceEntityName || sourceFieldName || "— unmapped —";

  async function save(newVerdict: string, newNotes: string) {
    if (!newVerdict) return;
    setSaveStatus("saving");
    try {
      await mutation.mutateAsync({
        id: mappingId,
        sourceVerdict: newVerdict,
        sourceVerdictNotes: newNotes || undefined,
      });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("idle");
    }
  }

  function handleVerdictChange(value: string) {
    setVerdict(value);
    if (value === "correct" || value === "should_be_unmapped") {
      save(value, "");
    }
  }

  function handleNotesBlur() {
    if (verdict && verdict !== "correct") {
      save(verdict, notes);
    }
  }

  const isWrong = verdict && verdict !== "correct";
  const StatusIcon = verdict === "correct"
    ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
    : verdict
    ? <XCircle className="h-3.5 w-3.5 text-red-400" />
    : null;

  return (
    <div className="border-b">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <span className="flex-1 text-left">Source Verdict</span>
        {StatusIcon}
        {saveStatus === "saving" && <span className="text-[10px] text-muted-foreground">saving…</span>}
        {saveStatus === "saved" && <span className="text-[10px] text-green-500">saved ✓</span>}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {/* Current source (read-only) */}
          <div className="text-[11px] text-muted-foreground font-mono bg-muted/50 rounded px-2 py-1 truncate">
            {sourceLabel}
          </div>

          {/* Verdict dropdown */}
          <select
            value={verdict}
            onChange={(e) => handleVerdictChange(e.target.value)}
            className={cn(
              "w-full text-xs rounded border bg-background px-2 py-1.5",
              "border-border focus:outline-none focus:ring-1 focus:ring-ring"
            )}
          >
            <option value="">— verdict —</option>
            {SOURCE_VERDICT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* Notes (shown when wrong) */}
          {isWrong && verdict !== "should_be_unmapped" && (
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={handleNotesBlur}
              placeholder="What should it be?"
              rows={2}
              className={cn(
                "w-full text-xs rounded border bg-background px-2 py-1.5 resize-none",
                "border-border focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
              )}
            />
          )}
        </div>
      )}
    </div>
  );
}
```

### Step 2: Build check

```bash
cd /Users/rob/code/surveyor
npx tsc --noEmit 2>&1 | grep source-verdict
```

Expected: No errors.

### Step 3: Commit

```bash
git add src/components/review/source-verdict-card.tsx
git commit -m "feat: add SourceVerdictCard component"
```

---

## Task 7: TransformVerdictCard component

**Files:**
- Create: `src/components/review/transform-verdict-card.tsx`

### Step 1: Create the component

```typescript
"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUpdateMappingVerdict } from "@/queries/mapping-queries";

const TRANSFORM_VERDICT_OPTIONS = [
  { value: "correct", label: "Correct" },
  { value: "not_needed", label: "Transform not needed — map directly" },
  { value: "needed_but_missing", label: "Transform needed but missing" },
  { value: "wrong_enum", label: "Incorrect enum mapping" },
  { value: "wrong_logic", label: "Logic is wrong" },
] as const;

interface TransformVerdictCardProps {
  mappingId: string;
  mappingType: string | null;
  transform: string | null;
  initialVerdict?: string | null;
  initialNotes?: string | null;
}

export function TransformVerdictCard({
  mappingId,
  mappingType,
  transform,
  initialVerdict,
  initialNotes,
}: TransformVerdictCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [verdict, setVerdict] = useState(initialVerdict ?? "");
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const mutation = useUpdateMappingVerdict();

  const transformLabel = transform
    ? transform.length > 60 ? transform.slice(0, 60) + "…" : transform
    : mappingType || "direct";

  async function save(newVerdict: string, newNotes: string) {
    if (!newVerdict) return;
    setSaveStatus("saving");
    try {
      await mutation.mutateAsync({
        id: mappingId,
        transformVerdict: newVerdict,
        transformVerdictNotes: newNotes || undefined,
      });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("idle");
    }
  }

  function handleVerdictChange(value: string) {
    setVerdict(value);
    if (value === "correct" || value === "not_needed") {
      save(value, "");
    }
  }

  function handleNotesBlur() {
    if (verdict && verdict !== "correct") {
      save(verdict, notes);
    }
  }

  const isWrong = verdict && verdict !== "correct";
  const StatusIcon = verdict === "correct"
    ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
    : verdict
    ? <XCircle className="h-3.5 w-3.5 text-red-400" />
    : null;

  return (
    <div className="border-b">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <span className="flex-1 text-left">Transform Verdict</span>
        {StatusIcon}
        {saveStatus === "saving" && <span className="text-[10px] text-muted-foreground">saving…</span>}
        {saveStatus === "saved" && <span className="text-[10px] text-green-500">saved ✓</span>}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {/* Current transform (read-only) */}
          <div className="text-[11px] text-muted-foreground font-mono bg-muted/50 rounded px-2 py-1 truncate">
            {transformLabel}
          </div>

          {/* Verdict dropdown */}
          <select
            value={verdict}
            onChange={(e) => handleVerdictChange(e.target.value)}
            className={cn(
              "w-full text-xs rounded border bg-background px-2 py-1.5",
              "border-border focus:outline-none focus:ring-1 focus:ring-ring"
            )}
          >
            <option value="">— verdict —</option>
            {TRANSFORM_VERDICT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* Notes (shown when wrong) */}
          {isWrong && verdict !== "not_needed" && (
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={handleNotesBlur}
              placeholder="Describe what's wrong or what should change"
              rows={2}
              className={cn(
                "w-full text-xs rounded border bg-background px-2 py-1.5 resize-none",
                "border-border focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
              )}
            />
          )}
        </div>
      )}
    </div>
  );
}
```

### Step 2: Build check

```bash
npx tsc --noEmit 2>&1 | grep transform-verdict
```

### Step 3: Commit

```bash
git add src/components/review/transform-verdict-card.tsx
git commit -m "feat: add TransformVerdictCard component"
```

---

## Task 8: QuestionFeedbackCard component

**Files:**
- Create: `src/components/review/question-feedback-card.tsx`

### Step 1: Create the component

```typescript
"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUpdateQuestionFeedback } from "@/queries/question-queries";

const WHY_NOT_OPTIONS = [
  { value: "too_vague", label: "Too vague" },
  { value: "wrong_thing", label: "Asks the wrong thing" },
  { value: "already_answered", label: "Already answered elsewhere" },
  { value: "not_needed", label: "Not needed" },
] as const;

interface QuestionFeedbackCardProps {
  questionId: string;
  questionText: string;
  initialHelpful?: boolean | null;
  initialWhyNot?: string | null;
  initialBetterQuestion?: string | null;
}

export function QuestionFeedbackCard({
  questionId,
  questionText,
  initialHelpful,
  initialWhyNot,
  initialBetterQuestion,
}: QuestionFeedbackCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [helpful, setHelpful] = useState<boolean | null>(initialHelpful ?? null);
  const [whyNot, setWhyNot] = useState(initialWhyNot ?? "");
  const [betterQuestion, setBetterQuestion] = useState(initialBetterQuestion ?? "");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const mutation = useUpdateQuestionFeedback();

  async function save(updates: Parameters<typeof mutation.mutateAsync>[0]) {
    setSaveStatus("saving");
    try {
      await mutation.mutateAsync({ id: questionId, ...updates });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("idle");
    }
  }

  function handleHelpfulToggle(value: boolean) {
    setHelpful(value);
    save({ feedbackHelpful: value });
  }

  function handleWhyNotChange(value: string) {
    setWhyNot(value);
    save({ feedbackHelpful: false, feedbackWhyNot: value });
  }

  function handleBetterQuestionBlur() {
    if (helpful === false) {
      save({ feedbackHelpful: false, feedbackWhyNot: whyNot || undefined, feedbackBetterQuestion: betterQuestion || undefined });
    }
  }

  const statusIndicator = helpful === true ? "✓ helpful" : helpful === false ? "✗ not helpful" : null;

  return (
    <div className="border-b">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <HelpCircle className="h-3.5 w-3.5" />
        <span className="flex-1 text-left">Question</span>
        {statusIndicator && (
          <span className={cn("text-[10px]", helpful ? "text-green-500" : "text-amber-500")}>
            {statusIndicator}
          </span>
        )}
        {saveStatus === "saving" && <span className="text-[10px] text-muted-foreground">saving…</span>}
        {saveStatus === "saved" && <span className="text-[10px] text-green-500">saved ✓</span>}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {/* Question text (read-only) */}
          <div className="text-[11px] text-foreground/80 bg-muted/50 rounded px-2 py-1.5 leading-relaxed">
            {questionText}
          </div>

          {/* Helpful toggle */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Does this unblock you?</span>
            <div className="flex gap-1">
              <button
                onClick={() => handleHelpfulToggle(true)}
                className={cn(
                  "px-2 py-0.5 text-[11px] rounded border transition-colors",
                  helpful === true
                    ? "bg-green-500/10 border-green-500/30 text-green-600"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                Yes
              </button>
              <button
                onClick={() => handleHelpfulToggle(false)}
                className={cn(
                  "px-2 py-0.5 text-[11px] rounded border transition-colors",
                  helpful === false
                    ? "bg-red-500/10 border-red-500/30 text-red-500"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                No
              </button>
            </div>
          </div>

          {/* Why not + better question (shown when not helpful) */}
          {helpful === false && (
            <>
              <select
                value={whyNot}
                onChange={(e) => handleWhyNotChange(e.target.value)}
                className={cn(
                  "w-full text-xs rounded border bg-background px-2 py-1.5",
                  "border-border focus:outline-none focus:ring-1 focus:ring-ring"
                )}
              >
                <option value="">— why not? —</option>
                {WHY_NOT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              <textarea
                value={betterQuestion}
                onChange={(e) => setBetterQuestion(e.target.value)}
                onBlur={handleBetterQuestionBlur}
                placeholder="Better question (optional)"
                rows={2}
                className={cn(
                  "w-full text-xs rounded border bg-background px-2 py-1.5 resize-none",
                  "border-border focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
                )}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

### Step 2: Build check

```bash
npx tsc --noEmit 2>&1 | grep question-feedback
```

### Step 3: Commit

```bash
git add src/components/review/question-feedback-card.tsx
git commit -m "feat: add QuestionFeedbackCard component"
```

---

## Task 9: Wire cards into the discuss page sidebar

**Files:**
- Modify: `src/app/(app)/mapping/discuss/[fieldMappingId]/discuss-client.tsx`

This is the integration step. Read the file before editing to understand exact current imports and sidebar structure.

### Step 1: Add imports at the top of discuss-client.tsx

Find the existing imports block and add:

```typescript
import { SourceVerdictCard } from "@/components/review/source-verdict-card";
import { TransformVerdictCard } from "@/components/review/transform-verdict-card";
import { QuestionFeedbackCard } from "@/components/review/question-feedback-card";
```

### Step 2: Add question data fetching

The discuss page needs to know if a question is linked to this field mapping. Check if there is already a query for questions. If there is a `useQuestions` hook or similar, use it with `{ fieldMappingId }` filter.

If no such hook exists, add a simple fetch to `src/queries/question-queries.ts`:

```typescript
export function useFieldMappingQuestion(fieldMappingId: string | undefined) {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: ["questions", "mapping", fieldMappingId],
    queryFn: () =>
      api.get<{ questions: Question[] }>(
        workspacePath(workspaceId, `questions?fieldMappingId=${fieldMappingId}`)
      ),
    enabled: !!fieldMappingId && !!workspaceId,
    select: (data) => data.questions?.[0] ?? null,
  });
}
```

Then verify the existing questions GET endpoint supports `?fieldMappingId=` filtering. If not, add it to the questions route.

### Step 3: Add the hook call inside the discuss page component

In `discuss-client.tsx`, near the top of the component body (alongside other data hooks), add:

```typescript
const { data: linkedQuestion } = useFieldMappingQuestion(fieldMappingId);
```

### Step 4: Add the three cards to the sidebar

Find the right sidebar section in discuss-client.tsx — it looks like:

```typescript
<div className="w-80 border-l flex flex-col overflow-y-auto">
  {mappingState && (
    <MappingStateCard ... />
  )}
  <PriorSessionsPanel ... />
  ...
</div>
```

Add the three verdict cards between `MappingStateCard` and `PriorSessionsPanel`:

```typescript
<div className="w-80 border-l flex flex-col overflow-y-auto">
  {mappingState && (
    <MappingStateCard ... />
  )}

  {/* Feedback verdict cards */}
  {mappingState && (
    <SourceVerdictCard
      mappingId={fieldMappingId}
      sourceEntityName={mappingState.sourceEntityName ?? null}
      sourceFieldName={mappingState.sourceFieldName ?? null}
      initialVerdict={mappingState.sourceVerdict ?? null}
      initialNotes={mappingState.sourceVerdictNotes ?? null}
    />
  )}

  {mappingState && (mappingState.transform || (mappingState.mappingType && mappingState.mappingType !== "direct")) && (
    <TransformVerdictCard
      mappingId={fieldMappingId}
      mappingType={mappingState.mappingType ?? null}
      transform={mappingState.transform ?? null}
      initialVerdict={mappingState.transformVerdict ?? null}
      initialNotes={mappingState.transformVerdictNotes ?? null}
    />
  )}

  {linkedQuestion && (
    <QuestionFeedbackCard
      questionId={linkedQuestion.id}
      questionText={linkedQuestion.question}
      initialHelpful={linkedQuestion.feedbackHelpful ?? null}
      initialWhyNot={linkedQuestion.feedbackWhyNot ?? null}
      initialBetterQuestion={linkedQuestion.feedbackBetterQuestion ?? null}
    />
  )}

  <PriorSessionsPanel ... />
  ...
</div>
```

### Step 5: Ensure mappingState type includes new fields

The `mappingState` object comes from a query. Check the type returned by the mapping API — it should now include `sourceVerdict`, `sourceVerdictNotes`, `transformVerdict`, `transformVerdictNotes` since they're in the schema. If the API response type needs updating, add the new fields to the relevant TypeScript type (likely in `src/types/` or inlined).

### Step 6: Build check

```bash
cd /Users/rob/code/surveyor
npx tsc --noEmit 2>&1
```

Expected: No errors.

### Step 7: Manual verification

1. Open `http://localhost:3000` and go to a field mapping in the discuss view
2. Verify the sidebar shows: MappingStateCard → Source Verdict card → Transform Verdict card (if transform exists) → PriorSessions
3. Select "Wrong table" in the Source Verdict dropdown → notes field appears → type a note → tab out
4. Check DB: `sqlite3 surveyor.db "SELECT source_verdict, source_verdict_notes FROM field_mapping WHERE id='<that mapping id>';"`
5. Check Entity Knowledge rebuilt: `sqlite3 surveyor.db "SELECT updated_at, substr(content,1,500) FROM context WHERE subcategory='entity_knowledge' AND name LIKE '%loss_mitigation%';"`
6. Confirm the learning appears in the content under "Source & Transform Corrections"

### Step 8: Commit

```bash
git add src/app/\(app\)/mapping/discuss/\[fieldMappingId\]/discuss-client.tsx
git add src/queries/question-queries.ts  # if modified
git commit -m "feat: integrate feedback verdict cards into discuss page sidebar"
```

---

## Task 10: Questions GET endpoint — fieldMappingId filter (if needed)

**Files:**
- Modify: `src/app/api/workspaces/[workspaceId]/questions/route.ts`

Only do this task if the questions endpoint doesn't already support `?fieldMappingId=` filtering (check in Task 9 Step 2).

### Step 1: Add filter to questions GET

In the questions GET route, find where query conditions are built and add:

```typescript
const fieldMappingId = url.searchParams.get("fieldMappingId");
if (fieldMappingId) {
  conditions.push(eq(question.fieldMappingId, fieldMappingId));
}
```

### Step 2: Build check + commit

```bash
npx tsc --noEmit
git add src/app/api/workspaces/[workspaceId]/questions/route.ts
git commit -m "feat: support fieldMappingId filter on questions GET endpoint"
```

---

## Done

At this point:
- Source and transform verdict cards are live in the discuss sidebar
- Saving a non-correct verdict creates a learning record and rebuilds Entity Knowledge immediately
- The Question card shows when a linked question exists and captures helpfulness feedback
- Better question text feeds back into Entity Knowledge as an open question signal
- The complete flow is: discuss field → give verdict → Entity Knowledge updated → next batch generation sees it
