# Broader Feedback Loop Validation — Results

**Date:** 2026-02-27
**Branch:** `rob/review-feedback-foundation`
**Entities tested:** 7 (loan, foreclosure, borrower, escrow_analysis, loss_mitigation_application, loss_mitigation_plan, bankruptcy_case)

## Summary

One cycle of auto-verdicts (using SOT as ground truth) doubled aggregate source-exact accuracy from **13.5% to 27.2%** across 7 entities. 4 of 7 entities improved, 2 held steady, 1 was blocked by a parsing bug (now fixed).

**Verdict: The feedback loop works.** Wrong-table corrections are highly effective. Wrong-field and missing-source corrections show partial improvement. The mechanism generalizes beyond the single entity it was built on.

## Results Table

```
                                    BASELINE            POST-FEEDBACK       DELTA
Entity                          Exact  Wrong       Exact  Wrong
────────────────────────────────────────────────────────────────────────────
loan                             0.0%    43         0.0%    43         — (Zod bug, now fixed)
foreclosure                     37.5%     5        71.4%     2        +33.9 pp
borrower                        33.3%     8        33.3%     8         — (DISJOINT→SUBSET)
escrow_analysis                  0.0%    12        50.0%     6        +50.0 pp
loss_mitigation_application      0.0%     6        50.0%     3        +50.0 pp
loss_mitigation_plan            40.0%     3        40.0%     3         —
bankruptcy_case                 27.8%    13        44.4%    10        +16.6 pp
────────────────────────────────────────────────────────────────────────────
AGGREGATE                       13.5%  (14/104)    27.2%  (28/103)   +13.7 pp
```

## What Worked

- **Wrong-table corrections** are the most effective verdict type. When the SOT says "use PaymentFactors, not EscrowAnalysisHistory," the model follows it. escrow_analysis jumped from 0% to 50% purely on table corrections.
- **loss_mitigation_application** went from 0 mappings to 25 persisted mappings and 50% accuracy — it had no EK in round 1, but round 2 naturally improved from better context assembly.
- **foreclosure** went from 37.5% to 71.4% — wrong-table and missing-source verdicts both landed.

## What Didn't Work (and Why)

### 1. `loan` — 0 mappings persisted (Zod parsing bug)

**Root cause:** The Zod schema in `output-parser.ts` rejected `null` values in `enumMapping` records (`z.record(z.string(), z.string())`). The LLM correctly returned `{"3": null}` for source codes with no target enum equivalent, but the entire 72-field output was discarded.

**Fix committed:** Changed to `z.string().nullable()`. Loan should work on next run.

### 2. Model overrides Entity Knowledge corrections (3 fields)

The EK phrasing "Should be: X" reads as a suggestion. The model actively argues against corrections:
- `foreclosure.judgement_entered_date` — "Step F11 is the standard judgment step"
- `escrow_analysis.current_escrow_balance` — "LoanInfo is cleaner than Transaction"
- `bankruptcy_case.chapter` — "DefaultWorkstations has more data coverage"

**Fix needed:** Stronger EK phrasing (e.g., "REQUIRED: Use X") or prompt-level instruction that EK corrections are authoritative.

### 3. Schema gaps — SOT references tables not in source schema (3 fields)

- `borrower.deceased_date` — SOT says `ExistingDeceasedBorrower` but only `DeceasedBorrower` exists
- `loss_mitigation_plan.plan_type/subtype` — SOT says `LSMTPlanTypes` but that table isn't imported

**Fix needed:** Import missing source tables from ACDC schema.

### 4. Borrower co-borrower fields — SUBSET, not EXACT (6 fields)

The SOT expects both mortgagor AND co-mortgagor fields. The model maps only the mortgagor. Entity Knowledge has the corrections but the model doesn't interpret "Expected sources: X, Y" as "map to both." Qualitatively better (DISJOINT→SUBSET) but not counted as exact.

**Fix needed:** More explicit learning format for multi-source mappings.

### 5. loss_mitigation_application — no EK existed (3 fields)

Round 1 had 0 mappings, so auto-verdicts had nothing to attach to. No learnings were ever created. The entity needs a second verdict+regen cycle now that it has mappings.

## Next Steps (Priority Order)

1. Re-run loan with Zod fix — should unlock 43 fields
2. Run a second verdict+regen cycle for all 7 (especially loss_mitigation_application)
3. Strengthen EK phrasing to prevent model overrides
4. Import missing source tables (LSMTPlanTypes, ExistingDeceasedBorrower, Courts)
5. Scale to all 92 entities once accuracy stabilizes above 40% aggregate

## Session Log

1. Created `scripts/multi-entity-eval.ts` — accepts entity names as CLI args, resolves from DB, runs generate → persist → SOT eval for each. Supports `--eval-only` mode.
2. Hit `.env.local` parsing bug: regex `$` anchor fails when lines have `\r` (Windows line endings). Fixed by removing `$`. Affected all scripts using the manual env loader.
3. Ran baseline generation on all 7 entities (~12 min total). `loan` and `loss_mitigation_application` persisted 0 mappings. Aggregate: 13.5% exact.
4. Created `scripts/auto-verdicts.ts` — reads SOT eval results, gives `wrong_table`/`wrong_field`/`missing_source` verdicts on wrong fields, calls `extractVerdictLearning` to rebuild Entity Knowledge docs.
5. Ran auto-verdicts: 39 verdicts across 5 entities (loan and loss_mitigation_application skipped — no mappings to attach to). Entity Knowledge rebuilt for foreclosure, borrower, escrow_analysis, loss_mitigation_plan, bankruptcy_case.
6. Regenerated all 7 entities with feedback in context. Aggregate jumped to 27.2%. escrow_analysis and loss_mitigation_application both +50pp.
7. Investigated three root cause categories for persistent errors:
   - **Zod bug** (`loan`): `enumMapping` schema rejected null values. LLM returned `{"3": null}` for unmappable codes, entire 72-field output discarded. One-line fix in `output-parser.ts`, 12 files for type propagation.
   - **Model overrides** (3 fields): Model reads EK corrections, acknowledges them, then argues back ("Step F11 is the standard judgment step"). EK phrasing too soft.
   - **Schema gaps** (3 fields): SOT references `LSMTPlanTypes`, `ExistingDeceasedBorrower`, `Courts` — tables not in the imported source schema.
8. Fixed Zod bug and committed. Committed results doc.
9. Side investigation: Supabase migration feasibility. Current DB is SQLite (better-sqlite3), 24.5 MB, 35 tables. Migration scope: 119 files, 709 sync→async calls, FTS5 rewrite. Team uses Supabase. Deferred — will plan after validation work stabilizes.
