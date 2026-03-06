Read all pending feedback briefs from ~/.claude/feedback-queue/briefs/ (JSON files where status is "pending"). Present them as a numbered list sorted by priority (high first), showing:

- Priority emoji: high=🔴, medium=🟡, low=🟢
- Category in brackets: [bug], [ux], [data], [feature], [question]
- One-line summary
- Suggested approach (indented below)

Skip items with confidence < 0.1 (non-actionable).

Example format:
```
3 pending items:

1. 🔴 HIGH [bug] Exclude button unresponsive on review page
   → Fix click handler in review-actions.tsx, missing await on mutation

2. 🟡 MED [ux] "Context Used" panel hard to read with long source names
   → Truncate with tooltip in context-panel.tsx
```

Ask which item to work on. When I pick one:
1. Read the full brief JSON
2. Open each file listed in `relevant_files`
3. Present the suggested approach and ask if I want to proceed or refine
4. After the fix is deployed, mark the brief as resolved by setting `status: "resolved"` and `resolved_at` to the current ISO timestamp
5. Ask if I want to notify the feedback author — if yes, draft a short Slack reply summarizing the change
