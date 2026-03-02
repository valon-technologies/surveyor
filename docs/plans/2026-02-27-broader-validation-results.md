# Broader Feedback Loop Validation — Results

**Date:** 2026-02-27
**Branch:** `rob/review-feedback-foundation`
**Entities tested:** 7 (loan, foreclosure, borrower, escrow_analysis, loss_mitigation_application, loss_mitigation_plan, bankruptcy_case)

## Summary

Two cycles of auto-verdicts (using SOT as ground truth) raised aggregate source-exact accuracy from **13.5% → 27.2% → 58.8% → 59.4%** across 7 entities.

- **Cycle 1** doubled accuracy (13.5% → 27.2%). Wrong-table corrections highly effective.
- **Cycle 2 baseline** jumped to 58.8% — Zod fix unlocked loan (48.8%), hardened EK phrasing lifted foreclosure (+16.7pp) and bankruptcy_case (+27.8pp).
- **Cycle 2 post-feedback** held at 59.4% — loan +11.7pp, loss_mit_app +33.3pp, bankruptcy +12pp, but borrower collapsed (0%) and escrow regressed (-16.6pp) due to aggressive SUBSET corrections.

**Verdict: The feedback loop works for DISJOINT corrections (wrong table → right table). SUBSET corrections (need additional sources) can cause catastrophic regressions when the model can't satisfy the constraint and gives up entirely.**

## Results Table

```
                              C1 Pre    C1 Post   C2 Pre    C2 Post
Entity                        Exact     Exact     Exact     Exact      Wrong
──────────────────────────────────────────────────────────────────────────────
loan                           0.0%      0.0%     48.8%     60.5%       17
foreclosure                   37.5%     71.4%     77.8%     77.8%        2
borrower                      33.3%     33.3%     41.7%      0.0%       12
escrow_analysis                0.0%     50.0%     58.3%     41.7%        7
loss_mitigation_application    0.0%     50.0%     50.0%     83.3%        1
loss_mitigation_plan          40.0%     40.0%     80.0%     80.0%        1
bankruptcy_case               27.8%     44.4%     72.2%     84.2%        3
──────────────────────────────────────────────────────────────────────────────
AGGREGATE                     13.5%     27.2%     58.8%     59.4%       43
                            (14/104)  (28/103)  (67/114)  (63/106)
```

**C1 Pre** = cycle 1 baseline (no feedback)
**C1 Post** = after first auto-verdicts
**C2 Pre** = after Zod fix + EK hardening (4-layer MANDATORY phrasing) + 3 new source tables
**C2 Post** = after second auto-verdicts with hardened phrasing

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

## Cycle 2 Analysis

### What the EK hardening fixed
- **DISJOINT corrections land reliably.** When EK says "REQUIRED: Use DefaultWorkstations.BankruptcyFilingDate (not EventDates.BankruptcyFilingDate)", the model follows it. All wrong_table verdicts in bankruptcy_case and loss_mit_app were corrected.
- **missing_source corrections work.** Previously unmapped fields (interest_only_remaining_term, mers_deactivated_reason) got mapped after "REQUIRED: Map to X" directives.
- **loan unlocked.** Zod fix + first cycle of corrections → 48.8%, then second cycle → 60.5%. 26/43 scored fields now correct.

### What broke: SUBSET correction catastrophe
- **borrower collapsed from 41.7% to 0%.** The model persisted 0 mappings. SUBSET corrections demanded "REQUIRED: Must include all of: MortgagorFirstName + CoMrtgrFirstName" — model couldn't satisfy multi-source constraint and gave up entirely.
- **escrow_analysis regressed from 58.3% to 41.7%.** Aggressive corrections about needing 7+ PaymentFactors fields created 3 new NO_GEN fields.
- **Pattern:** SUBSET verdicts produce corrections that are impossible for the model to satisfy within its single-source-per-mapping format. The model's response to an impossible MANDATORY constraint is to not map the field at all.

### Remaining wrong fields (43 total)
- **15 SUBSET in loan** — model maps the primary source but SOT expects additional fields (GseCode filter, co-calculations)
- **12 NO_GEN in borrower** — model gave up entirely
- **7 in escrow_analysis** — mix of SUBSET (4) and NO_GEN (3)
- **3 SUBSET in bankruptcy_case** — needs secondary status/date fields
- **2 in foreclosure** — 1 SUBSET, 1 DISJOINT (judgement_entered_date still wrong)
- **1 each in loss_mit_app and loss_mit_plan** — SUBSET patterns

## Next Steps (Priority Order)

1. **Fix SUBSET correction strategy** — rewrite SUBSET verdicts to accept primary source as correct and note secondary sources as "additional context" rather than MANDATORY requirements. Or: teach the model that multi-source mappings are valid.
2. **Investigate borrower 0-mapping regression** — delete borrower EK, regenerate to confirm it's the corrections causing the collapse, then rebuild with softer phrasing.
3. **Investigate foreclosure scored-field drop** — went from 18 to 9 scored fields between C2 Pre and C2 Post despite persisting 63 mappings both times.
4. **Third cycle** with fixed SUBSET strategy for remaining entities.
5. **Scale to all 92 entities** once aggregate stabilizes above 60%.

## Session Log

### Session 1 (cycle 1)
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

### Session 2 (EK hardening + cycle 2)
10. Hardened auto-verdict note templates in `scripts/auto-verdicts.ts` — all verdicts now use "REQUIRED: Use X" and "verified correction — do not override" phrasing. Committed `c000869`.
11. Hardened verdict learning content in `src/lib/generation/mapping-learning.ts` — all templates now use "CORRECTION (MANDATORY)" prefix. Committed `09301b3`.
12. Added ENTITY KNOWLEDGE RULE to both `SYSTEM_MESSAGE` and `YAML_SYSTEM_MESSAGE` in `src/lib/generation/prompt-builder.ts` — explicit instruction that EK corrections are authoritative and must not be overridden. Committed `491d757`.
13. Added authority preamble to EK corrections section header in `src/lib/generation/entity-knowledge.ts` — "Source & Transform Corrections (MANDATORY)" + "Follow each one exactly. Do NOT override." Committed `9f8b427`.
14. Manual feedback capture validation (Tasks 5-8): wrote `scripts/test-feedback.ts` to test 4 verdict types (wrong_table, wrong_field, wrong_logic, question resolution). All passed — confirmed end-to-end pipeline from verdict → learning with MANDATORY phrasing → EK rebuild. Cleaned up test data.
15. Checked BigQuery via Gestalt API — all 3 missing tables exist in `raw_acdc_m1` (66 total tables, 32 not in KNOWN_TABLES). Added Courts (4 fields, 390 rows), ExistingDeceasedBorrower (25 fields, 1 row), LSMTPlanTypes (6 fields, 63 rows) to `mapping-engine/engine/bq_context.py` KNOWN_TABLES and created cache JSONs. Re-ran import: 3 new source tables (35 fields), total now 41 sources, 5991 fields.
16. **Cycle 2 baseline** (generate + eval): 58.8% aggregate exact (67/114). loan unlocked at 48.8%, foreclosure 77.8% (+16.7pp), bankruptcy_case 72.2% (+27.8pp). Major jump from EK hardening + Zod fix + new source tables.
17. **Cycle 2 auto-verdicts**: 44 verdicts across all 7 entities with hardened REQUIRED phrasing. EK rebuilt for each entity.
18. **Cycle 2 post-feedback** (regenerate): 59.4% aggregate exact (63/106). loan +11.7pp, loss_mit_app +33.3pp, bankruptcy +12pp. But borrower collapsed to 0% (SUBSET corrections caused model to give up) and escrow regressed -16.6pp. Net gain: +0.6pp.
19. **Key finding:** SUBSET corrections are toxic. When the model can't satisfy "REQUIRED: Must include all of X, Y, Z" within single-source mapping format, it gives up and maps nothing. DISJOINT corrections remain highly effective. Next step: redesign SUBSET verdict strategy.
