# 2026-03-09 Transfer Generation Session

## Summary

Generated servicing transfer mappings for 6 new portfolios. Refactored create-transfer script to handle raw data files (CSV with data rows, xlsx). Ported SDT prompt quality fixes to transfer prompt builder.

## Portfolios Generated

| Portfolio | Source Fields | Tables | Mappings | Cost | Status |
|-----------|-------------|--------|----------|------|--------|
| Prime Lending | 316 | 1 (flat file) | 1,005 | ~$22 | reviewing |
| Premier | 291 | 1 (flat file) | 1,005 | ~$22 | reviewing |
| CMG | 173 | 1 (main only, 2 supplementary skipped) | 1,005 | ~$21 | reviewing |
| MISMO | 785 | 1 (raw data CSV, 33 loans) | 1,005 | ~$23 est | running |
| FNMA ULDD | 239 | 6 (multi-table relational) | 1,005 | ~$20 est | running |
| ServiceMac | 294 | 1 (header-only, no samples) | 1,005 | ~$20 est | running |

**Total estimated spend: ~$128**

## Tooling Improvements

### create-transfer.ts — Refactored for multiple input formats

Previously only accepted pre-parsed `source-fields.csv`. Now handles:
- **Raw data CSV** — auto-detects based on headers (no `position`/`field_name` columns). Extracts up to 5 unique sample values per field from data rows.
- **Raw data xlsx** — reads first sheet, headers from row 0, samples from data rows.
- **Pre-parsed source-fields.csv** — backward compatible.
- **Batch inserts** — 50 fields per INSERT for faster DB writes (was 1 at a time).
- Auto-generates `source-fields.csv` in the same directory for raw data inputs.

### Transfer prompt builder — Ported SDT quality fixes

- **System-generated FK fields**: Fields like `loan_id`, `borrower_id` marked unmapped without searching source fields (backtick escaping fix included).
- **Reasoning quality**: Explicit instruction + substantive example. No more lazy "Direct 1:1 match on name".
- **Deprecated fields**: Auto-skip with clear reasoning, no follow-up questions.
- **Date from boolean**: Don't fabricate dates from Y/N flags; flag as unmapped with follow-up.
- **Self-review checklist**: 4-item verification before output (source field existence, count match, calibrated confidence, sample value consideration).
- **Multiple sample values**: Source fields now show up to 5 unique samples (e.g., `samples: val1 | val2 | val3`) for better mapping context.

### run-transfer-generation.ts — Flow transfer principles from disk

- Reads `data/transfers/flow-transfer-principles.md` directly from disk and prepends to learnings context.
- Transfer-specific knowledge stays out of the shared Supabase context table (avoids polluting SDT Review workflow).
- Also passes `sampleValues` array (not just first sample) through to prompt builder.

## Multi-Table Source Support (FNMA ULDD)

FNMA ULDD arrived as 6 CSV tables + XML, all joined by `InvestorLoanIdentifier`:
- main (139 cols), parties (39), srppricing (21), armadjustments (20), documents (13), escrow (7)

Handled by prefixing field names with table name (e.g., `main.CurrentInterestRatePercent`, `parties.BorrowerBirthDate`). The existing pipeline works unchanged — the LLM sees table context in the field name and can reason about cross-table relationships.

## Retry Summary

Some domains hit intermittent `Error: terminated` (Anthropic API timeout). All resolved on retry:
- Premier: borrower + escrow retried successfully
- CMG: accounting retried successfully

## Files Created

| File | Purpose |
|------|---------|
| `scripts/create-transfer.ts` | Refactored: raw CSV/xlsx + pre-parsed input |
| `scripts/check-transfers.ts` | Quick DB query to list all transfers |
| `data/transfers/prime-lending/` | Source layout + parsed fields |
| `data/transfers/premier/` | Source layout + parsed fields |
| `data/transfers/cmg/` | Source layout + parsed fields (main table only) |
| `data/transfers/mismo/` | Raw data CSV (785 fields, 33 loans) + parsed fields |
| `data/transfers/fnma-uldd/` | 6 CSV tables + XML + parsed fields (table.field format) |
| `data/transfers/servicemac/` | Source layout + parsed fields (header-only, no samples) |

## Files Modified

| File | Change |
|------|--------|
| `scripts/run-transfer-generation.ts` | Flow principles from disk, sampleValues passthrough |
| `src/lib/generation/transfer-prompt-builder.ts` | FK fields, reasoning quality, deprecated, date-from-boolean, self-review checklist, multiple samples |

## Next Steps

1. Monitor MISMO, FNMA ULDD, ServiceMac generation runs
2. Retry any failed domains
3. Garrett reviews all 6 portfolios in Surveyor
4. Collect corrections → update flow-transfer-principles.md
