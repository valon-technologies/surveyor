# Feedback Agent Design

## Problem

The slowest part of the feedback-to-fix cycle is context-loading: translating raw Slack/Linear feedback into actionable work for Claude Code. This agent automates that translation.

## Architecture

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Background agent | `scripts/feedback-agent.ts` | Polls Slack + Linear, triages, writes briefs |
| Triage prompt | `scripts/feedback-agent-prompt.md` | System prompt with file index + schema |
| Config | `feedback-agent.config.json` | Channel, project, model, paths |
| Queue | `~/.claude/feedback-queue/` | State + briefs as JSON files |
| Command | `.claude/commands/feedback.md` | `/feedback` entry point in Claude Code |
| Scheduler | `~/Library/LaunchAgents/com.surveyor.feedback-agent.plist` | Runs agent every 30 min |

### Background Agent (`scripts/feedback-agent.ts`)

Runs every 30 minutes via launchd. On each run:

1. Pulls new messages from `#proj-surveyor-feedback` via Gestalt Slack integration
2. Pulls new/updated issues from the Surveyor Linear project via Gestalt Linear integration
3. Deduplicates linked items (Slack <-> Linear)
4. Sends each new item to Claude API (Haiku 4.5) for triage + brief generation
5. Writes briefs to `~/.claude/feedback-queue/briefs/` as JSON files
6. Updates state in `~/.claude/feedback-queue/state.json`

### Triage Schema

Each brief contains:

```json
{
  "id": "uuid",
  "created_at": "ISO timestamp",
  "status": "pending | resolved",
  "source": "slack | linear | both",
  "category": "bug | ux | data | feature | question",
  "priority": "high | medium | low",
  "confidence": 0.0-1.0,
  "summary": "one-line plain english",
  "suggested_approach": "what to change and where",
  "relevant_files": ["src/app/reviews/page.tsx"],
  "original_messages": {
    "slack": { "ts": "...", "text": "...", "user": "...", "permalink": "..." },
    "linear": { "id": "...", "title": "...", "url": "..." }
  },
  "resolved_at": null
}
```

### Triage Prompt

- Model: `claude-haiku-4-5-20251001` (~$0.01-0.02 per call)
- System prompt includes a lightweight file index (filename + one-line description) of Surveyor's source files
- File index regenerated every 7 days
- Input: raw Slack message or Linear issue (title + description + comments)
- Output: structured JSON matching the triage schema

### Deduplication Logic

- If a Slack message mentions a Linear issue ID (e.g., "VAL-123"), they are linked
- If a Linear issue was created within 10 minutes of a Slack message with similar keywords, they are linked
- Linked items produce one brief with both sources referenced

### `/feedback` Command

A Claude Code custom command (`.claude/commands/feedback.md`) that:

1. Reads `~/.claude/feedback-queue/briefs/` for items with `status: pending`
2. Presents a ranked list sorted by priority, showing category, confidence, and summary
3. User picks an item by number
4. Claude Code loads the full brief, opens relevant files, presents the suggested approach
5. User approves or refines, Claude Code executes the fix
6. After deployment, marks the brief as `resolved`
7. Optionally drafts a Slack reply via Gestalt for the user to approve

### Launchd Configuration

`~/Library/LaunchAgents/com.surveyor.feedback-agent.plist`:
- Runs `npx tsx scripts/feedback-agent.ts` from the Surveyor repo
- Every 30 minutes
- Logs to `~/.claude/feedback-queue/agent.log`

### Configuration

`feedback-agent.config.json`:
```json
{
  "slack_channel": "#proj-surveyor-feedback",
  "linear_project": "surveyor",
  "poll_interval_minutes": 30,
  "triage_model": "claude-haiku-4-5-20251001",
  "queue_dir": "~/.claude/feedback-queue",
  "file_index_refresh_days": 7
}
```

### Dependencies

- `GESTALT_API_KEY` (existing)
- `ANTHROPIC_API_KEY` (existing)
- Both read from existing `.env.local` or shell environment
