# Feedback Trail — Pipeline Event Log Design

## Problem

The feedback loop (verdict → learning → Entity Knowledge → context → generation → SOT eval) works end-to-end, but there's no visibility into whether each step actually fired. A reviewer gives a verdict and has to trust the system. We need instrumented proof that feedback is captured and utilized.

## Approach

Pipeline Event Log — a `feedbackEvent` table that records every step in the chain as it happens, surfaced in a timeline UI on the evaluation page.

## Schema

```sql
CREATE TABLE feedback_event (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspace(id),
  entity_id       TEXT NOT NULL REFERENCES entity(id),
  field_mapping_id TEXT REFERENCES field_mapping(id),
  event_type      TEXT NOT NULL,
  payload         TEXT NOT NULL DEFAULT '{}',  -- JSON
  correlation_id  TEXT,  -- groups events from same verdict action
  created_at      TEXT NOT NULL
);

CREATE INDEX idx_feedback_event_entity ON feedback_event(entity_id, created_at DESC);
CREATE INDEX idx_feedback_event_correlation ON feedback_event(correlation_id);
```

## Event Types

| eventType | Emitted from | Payload |
|-----------|-------------|---------|
| `verdict_submitted` | `verdict/route.ts` | `{ sourceVerdict, sourceVerdictNotes, transformVerdict, transformVerdictNotes, fieldName, sourceEntity, sourceField }` |
| `learning_created` | `mapping-learning.ts` `extractVerdictLearning()` | `{ learningId, scope, content, fieldName }` |
| `entity_knowledge_rebuilt` | `entity-knowledge.ts` `rebuildEntityKnowledge()` | `{ contextId, sectionCount, totalTokens, correctionCount, snippets[] }` |
| `context_assembled` | `context-assembler.ts` `assembleContext()` | `{ generationId?, entityKnowledgeIncluded, ekTokens, totalContextTokens, skillCount }` |
| `sot_evaluated` | `mapping-evaluator.ts` `evaluateEntityMappings()` | `{ evaluationId, sourceExactPct, sourceLenientPct, scoredFields, deltaFromPrevious? }` |

## Correlation Threading

- Steps 1→2→3 share a `correlationId` (generated in verdict route, passed through function args).
- Steps 4 and 5 are standalone events linked by `entityId` + timestamp ordering in the UI.

## Emission Points

### 1. `src/app/api/workspaces/[workspaceId]/mappings/[id]/verdict/route.ts`
- Generate `correlationId` (nanoid)
- Emit `verdict_submitted` with field/source details
- Pass `correlationId` to `extractVerdictLearning()`

### 2. `src/lib/generation/mapping-learning.ts`
- `extractVerdictLearning()` accepts optional `correlationId` param
- After learning insert, emit `learning_created`
- Pass `correlationId` to `rebuildEntityKnowledge()`

### 3. `src/lib/generation/entity-knowledge.ts`
- `rebuildEntityKnowledge()` accepts optional `correlationId` param
- After context upsert, emit `entity_knowledge_rebuilt` with correction count + snippet previews

### 4. `src/lib/generation/context-assembler.ts`
- After Entity Knowledge lookup (entityId path), emit `context_assembled`
- Records whether EK doc was found, its token count, total context stats

### 5. `src/lib/evaluation/mapping-evaluator.ts`
- After scoring, emit `sot_evaluated`
- Queries previous eval for same entity to compute `deltaFromPrevious`

## UI

### Location
Collapsible "Feedback Trail" section on the existing `/evaluation` page, below the per-field results table.

### Component
`src/components/evaluation/feedback-trail.tsx`

### Display
Reverse-chronological timeline grouped by `correlationId` (for correlated events) or 5-second time windows (for standalone events). Each group renders as a connected vertical chain showing event type, timestamp, and key payload values.

### API Route
`GET /api/workspaces/[workspaceId]/feedback-events?entityId=X`
Returns events sorted by `createdAt` desc. Client-side grouping.

## Out of Scope
- Automated testing / CI integration
- Changes to generation or evaluation logic
- New pages (just a section on existing eval page)
- Filtering/search beyond entity selection
