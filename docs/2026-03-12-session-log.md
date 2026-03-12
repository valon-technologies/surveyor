# Session Log — 2026-03-12

## Summary

Major session: M2.5 field gap fixed (104 → 321/321), exclusions management page built (MAP-892), context optimization deployed (MAP-893), transform accuracy eval shipped (MAP-856). AI review pass running for 28 entities. 6 new Linear tickets created.

---

## Tickets Completed

| Ticket | Feature | Commit |
|---|---|---|
| MAP-856 | Opus transform accuracy eval + enhanced SOT Accuracy UI | `ea27cff` |
| MAP-892 | VDS Exclusions page + auto-unexclude + Submit & Next fix | `a475342`, `0ca1922` |
| MAP-893 | Context optimization — RAG-only threshold + primary cap | `ab244c0` |
| MAP-894 | Bug: review queue includes excluded fields in navigation (resolved by MAP-892) | `0ca1922` |

## Tickets Created

| Ticket | Title | Priority |
|---|---|---|
| MAP-890 | Create Remotion video for Surveyor | Medium |
| MAP-891 | Updated roadmap for Surveyor | High |
| MAP-892 | Revert servicing transfer field exclusions | High |
| MAP-893 | More efficient context management for generation | Medium |
| MAP-895 | Ensure codebase ready for new developers on Surveyor UX | Medium |
| MAP-896 | Add product area to discuss pages (from VDS source file) | Medium |
| MAP-897 | Resolve Vercel deployment branch strategy | Medium |
| MAP-898 | AI review false disagreement (alias/synonym differences) | Medium |

## Linear Cleanup

- MAP-889 → Canceled (duplicate of completed MAP-888)
- MAP-884 → Canceled (entity/field exclusion already existed)
- MAP-856 → Completed
- MAP-892 → Completed
- MAP-894 → Completed (resolved by MAP-892)

---

## M2.5 Field Gap Fix

**Problem:** Only 104/321 M2.5 fields visible in review queue.

**Root causes:**
- **Case 1 (107 fields):** Never generated — no fieldMapping records at all
- **Case 2 (90 fields):** Had mappings, all retired (isLatest=false) by batch runner when LLM omitted fields from output

**Resolution:** 104 → **321/321** (full coverage)

Steps:
1. Restored 90 retired mappings via `scripts/restore-retired-m25.ts`
2. Context optimization (MAP-893): docs >10K tokens → RAG-only, 40K primary cap
3. Rewrote `fill-m25-gaps.ts` to use direct `runGeneration()` with explicit `fieldIds` (avoids batch runner retire-then-generate collateral damage)
4. Three gap-fill runs: 75 + 21 + 9 = 105 fields generated
5. Input tokens dropped from 1.1M+ to ~155-177K per entity after context optimization

**Issues found:**
- Batch runner `prepareEntityForRegeneration` retires ALL entity mappings before generating — causes collateral damage on partial LLM output (had to restore 3 times)
- `foreclosure`: stale generation lock from prior run (cleared manually)
- `loss_mitigation_payment_deferral`: first attempt produced no resolved mappings (succeeded on retry)

## AI Review Pass (In Progress)

Running Opus AI reviews for 28 entities with M2.5 fields missing reviews. 185 fields need review. Estimated cost ~$12.50. Reviews will show on discuss pages once complete.

## MAP-892: VDS Exclusions Management

Three fixes deployed:

1. **Exclusions page** at `/transfers/exclusions` — lists excluded entities (Restore All) + excluded fields (individual/bulk restore, search, checkboxes). Nav item under Servicing Transfers.
2. **Auto-unexclude** — mapping update on excluded field flips status to "unreviewed"
3. **Submit & Next skips excluded** — queue order in sessionStorage filters out excluded fields

## MAP-893: Context Optimization

18 docs >10K tokens (587K total) were being packed into every generation prompt. Moved to RAG-only (retrieved via FTS5 on demand). Added 40K soft cap on primary context with EK corrections prioritized.

## MAP-856: Transform Accuracy Eval

- New `transform-evaluator.ts` — Opus eval prompt ported from mapping-engine Python
- SOT YAML chain loader, transform capping logic
- Bug fix: transfer mapping bleed (`isNull(transferId)` filter)
- Enhanced SOT Accuracy UI: 4-6 metric cards, M1/M2 filter, scrollable field grid
- Eval results tainted (SOT used as generation context) — need `EXCLUDE_SOT=1` regen

## Vercel Deployment

**Issue found:** Vercel has NO Git integration — all deploys were manual `vercel --prod`. Pushes to master don't trigger auto-deploy. Manual deploy triggered this session to get changes live.

**Fix:** Connect Vercel to `github.com/valon-technologies/surveyor` with `master` as production branch (Vercel dashboard → Settings → Git). Tracked in MAP-897.

## Investigation: CMG VDS Field Count (1,005 vs 2,816)

Not a bug — tier 1 domains only (default generation scope). Tier 2 requires `--tier 2` flag.

---

## Still TODO

1. **Regenerate SDT mappings with `EXCLUDE_SOT=1`** — unbiased generation
2. **Re-run full eval** — clean accuracy numbers
3. **Connect Vercel to GitHub** (MAP-897) — enable auto-deploy
4. **MAP-891** — updated Surveyor roadmap
5. Raise CMG VDS field count question (tier 1 vs all tiers)

---

## Remaining Tickets (Needs Implementation)

### High
| Ticket | Title |
|---|---|
| MAP-858 | Generate mappings for M3 VDS fields |
| MAP-847 | BigQuery validation step |
| MAP-891 | Updated roadmap for Surveyor |

### Medium
| Ticket | Title |
|---|---|
| MAP-846 | Import DataDict legacy mappings as context |
| MAP-890 | Create Remotion video |
| MAP-895 | Codebase ready for new developers |
| MAP-896 | Add product area to discuss pages |
| MAP-897 | Resolve Vercel deployment branch strategy |
| MAP-898 | AI review false disagreement (alias/synonym) |

### Low (12)
MAP-835, MAP-834, MAP-837, MAP-838, MAP-839, MAP-840, MAP-842, MAP-844, MAP-849, MAP-850, MAP-853, MAP-879, MAP-883
