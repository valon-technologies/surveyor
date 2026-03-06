Read all pending feedback briefs from ~/.claude/feedback-queue/briefs/ (JSON files where status is "pending"). Present them as a numbered list sorted by priority (high first), showing:

- Priority emoji: high=🔴, medium=🟡, low=🟢
- Category in brackets: [bug], [ux], [data], [feature], [question]
- One-line summary
- Linear issue link if present
- Suggested approach (indented below)

Skip items with confidence < 0.1 (non-actionable).

Example format:
```
3 pending items:

1. 🔴 HIGH [bug] Exclude button unresponsive on review page (MAP-456)
   → Fix click handler in review-actions.tsx, missing await on mutation

2. 🟡 MED [ux] "Context Used" panel hard to read with long source names
   → Truncate with tooltip in context-panel.tsx
```

Ask which item to work on. When I pick one:
1. Read the full brief JSON
2. Open each file listed in `relevant_files`
3. Present the suggested approach and ask if I want to proceed or refine
4. After the fix is deployed, mark the brief as resolved by setting `status: "resolved"` and `resolved_at` to the current ISO timestamp
5. If the brief has a Linear issue (original_messages.linear.id), update it to "Completed" state by running:
   `curl -s -X POST "https://api.gestalt.peachstreet.dev/api/v1/linear/gql" -H "Authorization: Bearer $GESTALT_API_KEY" -H "Content-Type: application/json" -d '{"query":"mutation { issueUpdate(id: \"<ISSUE_ID>\", input: { stateId: \"54f4a7b9-f445-414d-97a2-501e5dd8aaff\" }) { success } }"}'`
6. Post a Slack message to #proj-surveyor-feedback (channel ID: C0AJQS4FHUM) summarizing the fix:
   `curl -s -X POST "https://api.gestalt.peachstreet.dev/api/v1/slack/send_message" -H "Authorization: Bearer $GESTALT_API_KEY" -H "Content-Type: application/json" -d '{"channel":"C0AJQS4FHUM","text":"🤖 *Fixed:* <summary of what was fixed and deployed>"}'`
