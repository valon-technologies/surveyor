# Session Log — 2026-03-11

## Summary

Massive productivity session: **18 tickets completed and deployed** to surveyor-pi.vercel.app. Covered UX improvements, bug fixes, data pipeline work, and new features across both SDT and servicing transfer workflows. Also ran full CMG re-generation ($20) with all 3 source file sheets.

---

## All Tickets Completed (18)

| # | Ticket | Feature | Commit |
|---|---|---|---|
| 1 | MAP-877 | Submit button edge cases (Flag & Next, Quick Accept) | `2903bc3` |
| 2 | MAP-878 | CMG multi-sheet source files + re-generation | `c42bb82` |
| 3 | MAP-869 | Suppress auto LLM chat on discuss pages | `ef38a9d` |
| 4 | MAP-871 | Gate exclusion to reviewed fields only | `ef38a9d` |
| 5 | MAP-875 | Return to Review Queue button | `ef38a9d` |
| 6 | MAP-876 | Fuzzy search on review queue | `10d7f63` |
| 7 | MAP-873 | Punt to specific person with user picker | `6adf2b0` |
| 8 | MAP-868 | My Verdicts page with nav from all surfaces | `9216fda` |
| 9 | MAP-872 | Workload summary by assignee at top of queue | `fd5e8a9` |
| 10 | MAP-870 | Optimistic claim checkbox + field-level exclude button | `edfb236` |
| 11 | MAP-885 | Checkbox-driven bulk actions (select + floating action bar) | `1dab867` |
| 12 | MAP-864 | Fix entity displayName (was showing descriptions) | `3c3863e` |
| 13 | MAP-862 | Parse extract forms into 174 per-entity Q&A context docs | `d4d2a0b` |
| 14 | MAP-863 | Import Jacksonville onsite transcripts (5 files, 124K tokens) | `d4d2a0b` |
| 15 | MAP-865 | Extract chat learnings into admin validation queue | `7bfd5ef` |
| 16 | MAP-888 | Scope AI chat RAG tools to transfer source files (not ACDC) | `6e98531` |
| 17 | (bug) | Assignment in-place update (not copy-on-write) | `60d8f84` |
| 18 | (fix) | Bulk exclude gate relaxed for action bar | `e28733f` |

## Additional Tickets Created

| Ticket | Title | Priority |
|---|---|---|
| MAP-879 | Create staging instance separate from production | Low |
| MAP-883 | Evaluate Tomato vs Vercel for Surveyor hosting | Low |
| MAP-884 | Servicing Transfer VDS Entity/Field Exclusion | Low |
| MAP-885 | Checkbox-driven bulk actions on review queue | High (completed) |
| MAP-888 | AI chat references ACDC fields in transfer context | Urgent (completed) |

## Linear Cleanup

- MAP-866, MAP-867 → Completed (resolved by MAP-877)
- MAP-880, MAP-881, MAP-882 → Canceled (duplicates from feedback agent)
- MAP-874 → Canceled (consolidated into MAP-870)

## Data Operations

- **CMG re-generation:** 1,005 mappings across 20 domains, all 219 source fields (3 sheets), $20 cost. Prior verdicts preserved.
- **Verdict carry-forward:** 3 verdicts carried from prior CMG versions where mapping unchanged.
- **Extract form parsing:** 1,468 Q&A rows from 5 XLSX files → 174 per-entity context docs (adhoc/extract).
- **Jacksonville transcripts:** 5 transcript files imported as adhoc/transcript context docs.
- **Chat learnings:** 5 insights extracted from 2 substantive chat sessions via Haiku.

## Scripts Created

| Script | Purpose |
|---|---|
| `scripts/backfill-cmg-sheets.ts` | Add missing Pay Histories + Escrow Line Detail sheets to CMG |
| `scripts/carry-forward-verdicts.ts` | Copy verdicts from prior versions where mapping unchanged |
| `scripts/fix-entity-displaynames.ts` | Fix 6 assembly entities with description as displayName |
| `scripts/parse-extract-forms.ts` | Parse extract request XLSX into per-entity Q&A context docs |
| `scripts/import-jacksonville-transcripts.ts` | Import onsite transcript files as context docs |
| `scripts/extract-chat-learnings.ts` | Extract insights from chat sessions via Haiku |

## Key Architectural Changes

- **Checkboxes refactored** from claim-only → general selection with floating bulk action bar (Claim, Assign to, Exclude)
- **My Verdicts page** at `/mapping/my-verdicts` — shows reviewer's verdict history filterable by workflow
- **Version history dropdown** in discuss page top bar — clickable version badge opens full mapping + verdict history
- **AI chat transfer scoping** — source schema search and sibling mapping lookup now filter by transfer's source files
- **Submit flow** — relaxed canSubmit with "Flag & Next" for partial reviews, "Accept & Next" for quick accept

---

## Remaining Tickets (18)

### High Priority
| Ticket | Title |
|---|---|
| MAP-858 | Generate mappings for M3 VDS fields |
| MAP-856 | Measure source + transform accuracy against M1/M2 SOT mappings |
| MAP-847 | BigQuery validation step — compare ACDC source vs VDS output |

### Medium Priority
| Ticket | Title |
|---|---|
| MAP-846 | Import DataDict legacy mappings as context |

### Low Priority (14)
MAP-834, MAP-835, MAP-837, MAP-838, MAP-839, MAP-840, MAP-842, MAP-844, MAP-849, MAP-850, MAP-853, MAP-879, MAP-883, MAP-884

---

## Late Session Additions

### Additional Tickets Completed
| Ticket | Feature | Commit |
|---|---|---|
| MAP-888 | Scope AI chat RAG tools to transfer source files (not ACDC) | `6e98531` |
| MAP-865 | Extract chat learnings into admin validation queue | `7bfd5ef` |
| MAP-864 | Fix entity displayName (was showing descriptions) | `3c3863e` |
| MAP-862 | Parse extract forms into 174 per-entity Q&A context docs | `d4d2a0b` |
| MAP-863 | Import Jacksonville onsite transcripts (5 files, 124K tokens) | `d4d2a0b` |
| MAP-885 | Checkbox-driven bulk actions (select + floating action bar) | `1dab867` |
| (fix) | Bulk exclude gate relaxed for action bar | `e28733f` |

**Updated total: 18 tickets completed and deployed.**

### MAP-856 Planning (In Progress)
Plan written for source + transform accuracy measurement against M1/M2 SOT:
- Port mapping-engine's `transform_evaluator.py` Opus-based eval to TypeScript
- 4 metrics: source exact, source lenient, transform exact, transform lenient
- ~$10-15 per full eval run across ~116 entities
- Plan file: `~/.claude/plans/dazzling-wiggling-rain.md`
- Next session: implement and run
