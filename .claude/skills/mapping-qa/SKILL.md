# Mapping QA

Diagnose why a field mapping was generated the way it was, and find generalizable skill-level improvements.

## When to Use

Use when the user points to a mapping (entity + field) and asks:
- "Why was this mapped this way?"
- "This mapping is wrong — where did it go wrong?"
- "The transform/source is incorrect — what context was missing?"
- "Should we update the skill for this?"

## Workflow

### 1. Load the mapping chain

Query the database to reconstruct the full decision chain:

```
fieldMapping → generationId → generation.promptSnapshot
                             → generation.validationScore / validationIssues
fieldMapping → entity → entityScaffold (topology, source tables)
fieldMapping → targetField (type, required, enum values)
```

Key fields on `fieldMapping`:
- `sourceEntity`, `sourceField` — what source the LLM picked
- `mappingType` — direct/rename/type_cast/enum/derived/conditional/etc.
- `transform` — the SQL/expression
- `reasoning` — LLM's own explanation of why
- `confidence` / `uncertaintyType` — self-assessed certainty
- `reviewComment` — reviewer notes
- `notes` — additional LLM notes

Key fields on `generation`:
- `promptSnapshot.skillsUsed` — which skills were matched
- `promptSnapshot.systemMessage` / `userMessage` — full prompt text
- `validationScore` / `validationIssues` — YAML validation results

### 2. Identify which contexts informed the decision

From `promptSnapshot.skillsUsed`, load the actual skill→context links:

```sql
SELECT sc.role, c.name, c.category, c.subcategory, c.tokenCount
FROM skillContext sc
JOIN context c ON sc.contextId = c.id
WHERE sc.skillId IN (:skillIds)
ORDER BY sc.role, sc.sortOrder
```

Map the context names to what appeared in the prompt sections:
- **Primary**: VDS entity doc + ServiceMac source table docs
- **Reference**: category overview + critical rules + patterns + enum maps + entity knowledge
- **Supplementary**: mortgage domain knowledge (regulatory context)

### 3. Diagnose the mapping decision

Compare the LLM's `reasoning` against the actual context content:

| Symptom | Root Cause | Where to Look |
|---------|-----------|---------------|
| Wrong source table | Scaffold topology incorrect or missing table in skill | `entityScaffold.sourceTables`, skill primary contexts |
| Wrong source field | Field not documented in source table context, or ambiguous | ServiceMac table context content |
| Wrong transform | Missing domain rule or enum map | Domain rules in prompt-builder, enum contexts |
| Wrong mapping type | Prompt instructions unclear for this pattern | `SYSTEM_MESSAGE` in prompt-builder.ts |
| Low confidence when it should be high | Missing context doc or entity knowledge | Context assembler gaps |
| High confidence but wrong | Misleading context or stale entity knowledge | Entity knowledge rebuild, learning table |
| Enum mismatch | Missing or stale enum_map context | ServiceMac enum contexts |
| FK/hash_id wrong | FK constraint store didn't propagate or wrong parent | `fk-constraint-store.ts`, batch run entity ordering |

### 4. Determine fix scope

Classify the fix by scope (most → least generalizable):

| Scope | What to Change | Example |
|-------|---------------|---------|
| **Domain rule** (prompt-builder) | Add/modify `DOMAIN_RULES` in `chat-prompt-builder.ts` or `SYSTEM_MESSAGE` in `prompt-builder.ts` | "Always use SAFE_CAST for dates" |
| **Mapping skill instruction** | Update `skill.instructions` for the matched skill | "For this entity pair, prefer joining on loan_number not loan_id" |
| **Context addition/update** | Add missing context doc or update stale one | Missing enum map, outdated VDS field doc |
| **Context role change** | Promote supplementary→reference or reference→primary in `skillContext` | Critical rule buried as supplementary |
| **Entity knowledge** | Add a `learning` record → triggers `rebuildEntityKnowledge()` | Specific field correction |
| **Scaffold fix** | Update entity scaffold topology or source table relevance | Wrong source table prioritization |

### 5. Propose the change

Structure the recommendation as:

1. **What's wrong**: The specific mapping error
2. **Why it happened**: What the LLM saw (or didn't see) in context
3. **Fix scope**: Which level from the table above
4. **Concrete change**: File + location + what to add/modify
5. **Impact radius**: How many other entities/fields would benefit from this fix

Prefer changes that fix the *class* of problem, not just the instance.

## Key Files

| Area | File |
|------|------|
| Mapping schema | `src/lib/db/schema.ts` — `fieldMapping`, `generation`, `skill`, `skillContext`, `context` |
| Prompt builder (YAML) | `src/lib/generation/prompt-builder.ts` — `buildYamlPrompt`, `SYSTEM_MESSAGE` |
| Chat prompt builder | `src/lib/generation/chat-prompt-builder.ts` — `DOMAIN_RULES`, `renderWorkspaceRulesSection` |
| Context assembler | `src/lib/generation/context-assembler.ts` — `matchSkills`, `assembleContext` |
| Entity knowledge | `src/lib/generation/entity-knowledge.ts` — `rebuildEntityKnowledge` |
| Runner | `src/lib/generation/runner.ts` — `startGeneration`, source table relevance signals |
| Batch runner | `src/lib/generation/batch-runner.ts` — `saveMappingsAndQuestions`, question suppression |
| FK constraints | `src/lib/generation/fk-constraint-store.ts` — cross-entity constraint propagation |
| Scaffold | `src/lib/generation/scaffolding-engine.ts` — topology classification |
| Skill signals | `src/lib/db/schema.ts` — `skillSignal`, `skillRefresh` tables |
| System context | `src/lib/generation/system-context.ts` — `SYSTEM_EMBEDDED_NAMES` |

## Database Queries

### Load mapping with full context
```sql
SELECT fm.*, e.name as entityName, f.name as fieldName, f.dataType, f.isRequired,
       g.promptSnapshot, g.validationScore, g.validationIssues,
       es.topology, es.sourceTables
FROM fieldMapping fm
JOIN field f ON fm.targetFieldId = f.id
JOIN entity e ON f.entityId = e.id
LEFT JOIN generation g ON fm.generationId = g.id
LEFT JOIN entityScaffold es ON es.entityId = e.id AND es.isLatest = 1
WHERE fm.id = :mappingId AND fm.isLatest = 1
```

### Load skills that matched this entity
```sql
SELECT s.id, s.name, s.instructions, s.applicability
FROM skill s
WHERE s.workspaceId = :workspaceId AND s.isActive = 1
-- then filter in code via matchSkills()
```

### Check if there's already entity knowledge
```sql
SELECT c.id, c.name, c.content, c.updatedAt
FROM context c
WHERE c.subcategory = 'entity_knowledge'
  AND c.name LIKE 'Entity Knowledge > %'
  AND c.workspaceId = :workspaceId
```

### Check existing learnings for this field
```sql
SELECT l.*
FROM learning l
WHERE l.entityId = :entityId
  AND (l.fieldId = :fieldId OR l.scope = 'entity' OR l.scope = 'workspace')
ORDER BY l.createdAt DESC
```

## Response Format

When diagnosing, structure your answer as:

1. **Mapping summary**: Entity, field, current source→target mapping, transform, confidence
2. **Generation trace**: Which skills matched, which contexts were in the prompt, token budget usage
3. **Root cause**: Why the LLM made this decision (what it saw or didn't see)
4. **Fix scope**: Domain rule / skill instruction / context / entity knowledge / scaffold
5. **Proposed change**: Concrete edit with file path and content
6. **Impact**: How many similar mappings this would improve

## Connecting to Skill Refresh (Phase 4)

If the fix is at the skill level, consider creating a `skillSignal` record:
- `signalType`: `"mapping_correction"` or `"context_gap"`
- `skillId`: the matched skill
- `payload`: `{ fieldMappingId, currentMapping, proposedFix, riskScore }`

This feeds the `skillRefresh` pipeline (when implemented) for automated skill evolution.
