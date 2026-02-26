# Feedback Interface Design
**Date:** 2026-02-26
**Branch:** rob/review-feedback-foundation

## Problem

The mapping generator needs to learn from mistakes. Currently, when a reviewer corrects a mapping (via the discuss/chat page), the correction is captured in Entity Knowledge and flows into the next generation. But there is no structured way to record *why* a mapping was wrong — only *what* it was changed to. Without structured "why" data, the generator can't avoid the same class of mistake on future fields or entities.

## Goal

Add explicit structured feedback capture to the discuss page — one panel each for source correctness, transform correctness, and question quality — so that every reviewed mapping accumulates machine-readable signal that closes the feedback loop.

## Design

### Layout

The discuss page right sidebar gains three collapsible cards below the existing `MappingStateCard`, above `PriorSessionsPanel`:

```
┌──────────────────┐
│  MappingStateCard│  (unchanged)
├──────────────────┤
│ ▼ Source Verdict │  NEW — always shown
├──────────────────┤
│ ▼ Transform      │  NEW — shown when transform non-null or mappingType ≠ 'direct'
├──────────────────┤
│ ▼ Question       │  NEW — shown only when a question is linked to this field
├──────────────────┤
│  PriorSessions   │  (unchanged, pushed down)
└──────────────────┘
```

Cards auto-save on blur/change with a `saved ✓` status indicator in the header. No submit button.

---

### Source Verdict Card

**Always shown.**

- Pre-populated read-only display: current source entity + field
- **Verdict dropdown** (required to submit):
  - `correct` — model got it right
  - `wrong_table` — right field name, wrong source entity
  - `wrong_field` — right entity, wrong field within it
  - `should_be_unmapped` — no source exists; model hallucinated one
  - `missing_source` — source exists but model left it unmapped
- If verdict ≠ `correct`: free-text **Notes** field ("What should it be?")

---

### Transform Verdict Card

**Shown when `transform` is non-null or `mappingType` ≠ `direct`.**

- Pre-populated read-only display: mapping type + transform SQL snippet
- **Verdict dropdown:**
  - `correct`
  - `not_needed` — model added a transform but direct mapping is correct
  - `needed_but_missing` — model mapped directly but a conversion is required
  - `wrong_enum` — enum values are mapped incorrectly or incompletely
  - `wrong_logic` — transform SQL logic is incorrect
- If verdict ≠ `correct`: free-text **Notes** field

---

### Question Card

**Shown only when a `question` record is linked to this field mapping.**

- Read-only display of the question text
- **Toggle:** "Does this question unblock you?" → Yes / No
- If No:
  - **Why dropdown:** `Too vague` / `Asks the wrong thing` / `Already answered elsewhere` / `Not needed`
  - **Better question** textarea (optional free text)

---

## Data Storage

### `field_mapping` table — 4 new nullable columns

| Column | Type | Values |
|---|---|---|
| `source_verdict` | text | `correct` \| `wrong_table` \| `wrong_field` \| `should_be_unmapped` \| `missing_source` |
| `source_verdict_notes` | text | free text |
| `transform_verdict` | text | `correct` \| `not_needed` \| `needed_but_missing` \| `wrong_enum` \| `wrong_logic` |
| `transform_verdict_notes` | text | free text |

Saving a verdict does **not** create a new copy-on-write version. Verdicts are annotations on the current mapping version, not corrections to it.

### `question` table — 3 new nullable columns

| Column | Type | Values |
|---|---|---|
| `feedback_helpful` | integer | `1` (yes) \| `0` (no) |
| `feedback_why_not` | text | `too_vague` \| `wrong_thing` \| `already_answered` \| `not_needed` |
| `feedback_better_question` | text | free text |

### API

- `PATCH /api/workspaces/[workspaceId]/mappings/[id]/verdict`
  - Body: `{ sourceVerdict?, sourceVerdictNotes?, transformVerdict?, transformVerdictNotes? }`
  - Saves verdict fields to DB; triggers learning extraction if any verdict is non-`correct`
  - Does NOT create a new mapping version

- `PATCH /api/workspaces/[workspaceId]/questions/[id]/feedback`
  - Body: `{ feedbackHelpful?, feedbackWhyNot?, feedbackBetterQuestion? }`
  - Saves question feedback fields

---

## Feedback → Learning Pipeline

When a non-`correct` verdict is saved, a `learning` record is created (`scope='field'`, `source='review'`) and `rebuildEntityKnowledge` is triggered immediately. This is the same fast-loop path already verified to work.

### Source verdict → learning content

| Verdict | Learning text |
|---|---|
| `wrong_table` | "For [entity].[field]: Source table is wrong. Model used [current entity] — correct source is [notes]." |
| `wrong_field` | "For [entity].[field]: Source field is wrong within [entity]. Notes: [notes]" |
| `should_be_unmapped` | "For [entity].[field]: This field has no source. Do NOT attempt to map it — leave unmapped." |
| `missing_source` | "For [entity].[field]: This field has a source but was left unmapped. Notes: [notes]" |

### Transform verdict → learning content

| Verdict | Learning text |
|---|---|
| `not_needed` | "For [entity].[field]: No transform required — map directly." |
| `needed_but_missing` | "For [entity].[field]: A transform is required. Notes: [notes]" |
| `wrong_enum` | "For [entity].[field]: Enum mapping is incorrect. Notes: [notes]" |
| `wrong_logic` | "For [entity].[field]: Transform logic is wrong. Notes: [notes]" |

### Question feedback → Entity Knowledge

If `feedback_helpful = false` and a better question is provided, the replacement question text is appended to the Entity Knowledge doc under an "Unresolved Questions" section so the generator treats it as a live blocker.

### What does NOT happen automatically

- No auto-regeneration — user still triggers batch manually
- No auto-correction of the mapping — verdicts are observations, not edits

---

## File Locations

| What | Where |
|---|---|
| Discuss page | `src/app/(app)/mapping/discuss/[fieldMappingId]/discuss-client.tsx` |
| Sidebar components | `src/components/review/` (new: `source-verdict-card.tsx`, `transform-verdict-card.tsx`, `question-feedback-card.tsx`) |
| DB schema | `src/lib/db/schema.ts` |
| Migration | `drizzle/migrations/` |
| Verdict API route | `src/app/api/workspaces/[workspaceId]/mappings/[id]/verdict/route.ts` |
| Question feedback API | `src/app/api/workspaces/[workspaceId]/questions/[id]/feedback/route.ts` |
| Learning extraction | `src/lib/generation/mapping-learning.ts` (extend `extractMappingLearning`) |
| Entity Knowledge | `src/lib/generation/entity-knowledge.ts` (extend to include verdict-sourced learnings) |
