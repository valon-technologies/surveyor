# Question QA

Diagnose why a surveyor question was generated and find generalizable ways to prevent unnecessary ones.

## When to Use

Use when the user pastes a question from the surveyor review queue and asks:
- "Why did it ask this?"
- "How do I prevent this type of question?"
- "This was already answered — why did it come back?"

## Workflow

1. **Identify the generation path** — determine which code path created the question:

   | `askedBy` | Path | Code Location |
   |-----------|------|---------------|
   | `llm` + has `fieldMappingId` | LLM explicit question from batch output | `batch-runner.ts` → `saveMappingsAndQuestions` section 1 |
   | `llm` + low/medium confidence | Gap-fill auto-question from uncertain mapping | `batch-runner.ts` → `saveMappingsAndQuestions` section 2 |
   | `validator` | YAML validation error converted to question | `batch-runner.ts` → `createValidationQuestions` / `yaml-validator.ts:issueToQuestion` |
   | `llm` + has `chatSessionId` | Context gap extracted from chat LLM response | `context-gap-extractor.ts:extractAndPersistContextGaps` |
   | `user` | Manual creation or punt action | `questions/route.ts` or `punt/route.ts` |

2. **Diagnose root cause** — read the relevant prompt/context to understand *why* the LLM asked it:
   - Check `src/lib/generation/prompt-builder.ts` for the system prompt instructions about questions
   - Check `src/lib/generation/yaml-validator.ts:issueToQuestion` for validation-to-question mappings
   - Check `src/lib/generation/context-assembler.ts` for what context the LLM received
   - Check `src/lib/generation/entity-knowledge.ts` for what resolved Q&A was already fed back

3. **Propose a generalizable fix** — not a one-off patch, but a systemic improvement:
   - **If already answered**: Check why the dedup in `saveMappingsAndQuestions` didn't catch it (is `resolvedFieldIds` populated? Is the fieldId linked?)
   - **If cascade should have resolved it**: Check if the original resolution had a `fieldId` (entity-level questions skip cascade)
   - **If the LLM keeps asking the same type of question**: Consider adding to the prompt builder's "do not ask" instructions, or enriching the entity knowledge context
   - **If a validation error is spurious**: Fix the validator rule in `yaml-validator.ts`
   - **If confidence is unnecessarily low**: Check what context was missing from the skill/context assembly

## Key Files

- `src/lib/generation/batch-runner.ts` — question creation (3 paths) + dedup via `resolvedFieldIds`
- `src/lib/generation/prompt-builder.ts` — LLM instructions that produce questions
- `src/lib/generation/yaml-validator.ts` — validation errors → questions (`issueToQuestion`)
- `src/lib/generation/entity-knowledge.ts` — resolved Q&A fed back to LLM (`rebuildEntityKnowledge`)
- `src/lib/generation/context-gap-extractor.ts` — chat context gap detection
- `src/app/api/workspaces/[workspaceId]/questions/[id]/resolve/route.ts` — resolution + cascade logic
- `src/lib/generation/context-assembler.ts` — what context the LLM receives per entity

## Dedup Mechanisms (current)

1. **Resolution cascade** (resolve route): resolving a field-level question auto-resolves other open questions for same entity+field
2. **Creation-time dedup** (batch runner): skips question creation if a resolved question with an answer already exists for same entity+field
3. **Stale dismissal** (prepareEntityForRegeneration): dismisses open LLM/validator questions before re-running an entity

## Response Format

When diagnosing, structure your answer as:
1. **Generation path**: Which code path created it
2. **Why it was asked**: What the LLM/validator saw (or didn't see) that triggered it
3. **Why dedup didn't catch it**: If applicable
4. **Fix**: Concrete code change with file + location, preferring generalizable solutions
