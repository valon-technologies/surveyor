# Session Log — 2026-03-11

## Linear Ticket Triage & Creation

Deduped user-requested changes against existing Linear tickets and git history from the past week (78 commits, 59 existing tickets).

### New Tickets Created (Needs Implementation)
| Ticket | Title | Priority |
|---|---|---|
| MAP-868 | Navigable prior mapping verdicts in review queue and discuss page | High |
| MAP-869 | Suppress automatic LLM chat on discuss pages | High |
| MAP-870 | Reduce checkmark response time and field-level ST exclusion toggles | High |
| MAP-871 | Gate ST mapping exclusion to reviewed fields only | High |
| MAP-872 | Assigned fields summary with workload by user at top of review queue | High |
| MAP-873 | Punt to specific person with optional note | High |
| MAP-875 | Add Return to Review Queue button on discuss page | High |
| MAP-876 | Enable fuzzy search on review queue | High |
| MAP-877 | Fix Submit Review & Next button edge cases | Urgent |
| MAP-878 | Transfer generation not considering all source files (CMG escrow) | Urgent |

MAP-874 (Exclude on discuss page for ST) consolidated into MAP-870.

### Existing Tickets Updated (New Field -> Needs Implementation)
MAP-862, MAP-863, MAP-864, MAP-865 moved to Needs Implementation and associated with Surveyor UX Feedback project.

---

## MAP-877: Fix Submit Review & Next Button Edge Cases

**Status:** In Progress

### Problem
Three edge cases with the Submit Review & Next button on discuss pages:
1. Button disabled when reviewer has a question but doesn't want to confirm the mapping
2. No quick-accept shortcut when AI first pass and review agree with no questions
3. `canSubmit` logic too rigid — requires all 3 verdicts (source, transform, question)

### Implementation (Complete)

**Files modified:**
- `src/lib/analytics/use-review-analytics.ts` — `trackSubmitted` now accepts optional `properties` param for `submitType`/`quickAccept`
- `src/app/mapping/discuss/[fieldMappingId]/discuss-client.tsx` — 3 changes:

**1. Relaxed `canSubmit` + "Flag & Next":**
- New `hasNewQuestion` state, set via `onCreated` callback on `CreateQuestionCard`
- `canSubmit = allVerdictsComplete || (isUnmapped && questionDecision) || hasAnyAction`
- Partial submissions (question-only, partial verdicts) → status `needs_discussion` with purple "Flag & Next" button
- Full verdicts → status `accepted` with blue "Submit & Next" button (unchanged)

**2. Quick Accept button:**
- Green "Accept & Next" with Zap icon appears when AI has reviewed and confirms current mapping with no changes/questions and reviewer hasn't started verdicts
- Auto-sets source/transform to "correct", tracks acceptance, submits as accepted, navigates to next

**3. Status bar dots:**
- Show "skipped" (gray) for unset verdicts when reviewer has taken other action
- Question dot shows "asked" when new question created

TypeScript build passes clean.

---

### Additional Tickets Created
| Ticket | Title | Priority |
|---|---|---|
| MAP-879 | Create staging instance separate from production | Low |
| MAP-883 | Evaluate Tomato vs Vercel for Surveyor hosting | Low |
