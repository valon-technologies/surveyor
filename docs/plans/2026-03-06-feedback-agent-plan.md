# Feedback Agent Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a background agent that polls Slack + Linear for feedback, triages it with Haiku, and queues structured briefs for a `/feedback` command in Claude Code.

**Architecture:** A TypeScript script (`scripts/feedback-agent.ts`) runs every 30 min via launchd. It fetches new feedback from Gestalt Slack + existing Gestalt Linear client, deduplicates, triages each item via Haiku, and writes JSON briefs to `~/.claude/feedback-queue/`. A custom command `.claude/commands/feedback.md` reads the queue and presents actionable items.

**Tech Stack:** TypeScript, tsx, Anthropic SDK (Haiku 4.5), Gestalt API (Slack + Linear), launchd

---

### Task 1: Gestalt Slack Client

**Files:**
- Create: `src/lib/slack/gestalt-slack-client.ts`

**Step 1: Create the Slack client**

Follow the pattern from `src/lib/linear/gestalt-linear-client.ts`. The Gestalt Slack API uses REST, not GraphQL.

```typescript
const GESTALT_BASE = "https://api.gestalt.peachstreet.dev/api/v1";

function getApiKey(): string {
  const key = process.env.GESTALT_API_KEY;
  if (!key) throw new Error("GESTALT_API_KEY not set");
  return key;
}

export interface SlackMessage {
  ts: string;
  text: string;
  user: string;
  thread_ts?: string;
  permalink?: string;
}

interface SlackHistoryResponse {
  messages: SlackMessage[];
  has_more: boolean;
  response_metadata?: { next_cursor?: string };
}

/** Fetch channel history from Slack via Gestalt */
export async function fetchChannelHistory(
  channelName: string,
  oldest?: string,
): Promise<SlackMessage[]> {
  // First, resolve channel name to ID
  const channelsRes = await fetch(`${GESTALT_BASE}/slack/list_channels`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ limit: 200 }),
  });
  if (!channelsRes.ok) throw new Error(`Gestalt Slack list_channels failed: ${await channelsRes.text()}`);
  const channelsData = await channelsRes.json();
  const channel = channelsData.channels?.find(
    (c: { name: string }) => c.name === channelName.replace(/^#/, ""),
  );
  if (!channel) throw new Error(`Channel ${channelName} not found`);

  // Fetch history
  const params: Record<string, unknown> = { channel: channel.id, limit: 100 };
  if (oldest) params.oldest = oldest;

  const historyRes = await fetch(`${GESTALT_BASE}/slack/get_channel_history`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  if (!historyRes.ok) throw new Error(`Gestalt Slack history failed: ${await historyRes.text()}`);
  const data: SlackHistoryResponse = await historyRes.json();
  return data.messages || [];
}

/** Send a message to a Slack channel via Gestalt */
export async function sendSlackMessage(
  channelId: string,
  text: string,
  threadTs?: string,
): Promise<void> {
  const params: Record<string, unknown> = { channel: channelId, text };
  if (threadTs) params.thread_ts = threadTs;

  const res = await fetch(`${GESTALT_BASE}/slack/send_message`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`Gestalt Slack send_message failed: ${await res.text()}`);
}
```

**Step 2: Verify it compiles**

Run: `cd /Users/rob/code/surveyor && npx tsc --noEmit src/lib/slack/gestalt-slack-client.ts 2>&1 | head -20`

**Step 3: Commit**

```bash
git add src/lib/slack/gestalt-slack-client.ts
git commit -m "feat: add Gestalt Slack client for feedback agent"
```

---

### Task 2: Feedback Queue Types and Config

**Files:**
- Create: `scripts/feedback-agent/types.ts`
- Create: `feedback-agent.config.json`

**Step 1: Create shared types**

```typescript
export interface FeedbackBrief {
  id: string;
  created_at: string;
  status: "pending" | "resolved";
  source: "slack" | "linear" | "both";
  category: "bug" | "ux" | "data" | "feature" | "question";
  priority: "high" | "medium" | "low";
  confidence: number;
  summary: string;
  suggested_approach: string;
  relevant_files: string[];
  original_messages: {
    slack?: { ts: string; text: string; user: string; permalink?: string };
    linear?: { id: string; identifier: string; title: string; url: string };
  };
  resolved_at: string | null;
}

export interface AgentState {
  last_slack_ts: string | null;
  last_linear_sync: string | null;
  processed_linear_ids: string[];
}

export interface AgentConfig {
  slack_channel: string;
  linear_project: string;
  linear_project_id: string;
  poll_interval_minutes: number;
  triage_model: string;
  queue_dir: string;
  file_index_refresh_days: number;
}
```

**Step 2: Create config file**

```json
{
  "slack_channel": "#proj-surveyor-feedback",
  "linear_project": "surveyor",
  "linear_project_id": "",
  "poll_interval_minutes": 30,
  "triage_model": "claude-haiku-4-5-20251001",
  "queue_dir": "~/.claude/feedback-queue",
  "file_index_refresh_days": 7
}
```

Note: `linear_project_id` needs to be filled in. Find it by running the existing Linear sync script or checking Linear URL.

**Step 3: Commit**

```bash
git add scripts/feedback-agent/types.ts feedback-agent.config.json
git commit -m "feat: add feedback agent types and config"
```

---

### Task 3: File Index Generator

**Files:**
- Create: `scripts/feedback-agent/file-index.ts`

**Step 1: Build the file index generator**

Scans Surveyor's `src/` directory and generates a lightweight index (path + first JSDoc comment or export name) for the triage prompt.

```typescript
import { readdirSync, readFileSync, statSync, existsSync, writeFileSync } from "fs";
import { join, relative } from "path";

const SRC_ROOT = join(__dirname, "../../src");
const EXTENSIONS = [".ts", ".tsx"];

interface FileEntry {
  path: string;
  summary: string;
}

function getFirstComment(content: string): string {
  // Extract first JSDoc or // comment
  const jsdoc = content.match(/\/\*\*\s*\n?\s*\*?\s*(.+)/);
  if (jsdoc) return jsdoc[1].replace(/\*\/.*/, "").trim();
  const line = content.match(/^\/\/\s*(.+)/m);
  if (line) return line[1].trim();
  // Fall back to first export name
  const exp = content.match(/export (?:default )?(?:function|const|class) (\w+)/);
  if (exp) return `exports ${exp[1]}`;
  return "";
}

function walkDir(dir: string): FileEntry[] {
  const entries: FileEntry[] = [];
  for (const item of readdirSync(dir)) {
    const full = join(dir, item);
    const stat = statSync(full);
    if (stat.isDirectory() && !item.startsWith(".") && item !== "node_modules") {
      entries.push(...walkDir(full));
    } else if (EXTENSIONS.some((ext) => item.endsWith(ext))) {
      const content = readFileSync(full, "utf-8");
      const summary = getFirstComment(content);
      entries.push({ path: relative(SRC_ROOT, full), summary });
    }
  }
  return entries;
}

export function generateFileIndex(): FileEntry[] {
  return walkDir(SRC_ROOT);
}

export function fileIndexToString(entries: FileEntry[]): string {
  return entries
    .map((e) => `${e.path}${e.summary ? ` — ${e.summary}` : ""}`)
    .join("\n");
}

/** Generate and cache file index. Refreshes if older than `maxAgeDays`. */
export function getOrRefreshFileIndex(cacheDir: string, maxAgeDays: number): string {
  const cachePath = join(cacheDir, "file-index.txt");
  if (existsSync(cachePath)) {
    const stat = statSync(cachePath);
    const ageDays = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);
    if (ageDays < maxAgeDays) {
      return readFileSync(cachePath, "utf-8");
    }
  }
  const entries = generateFileIndex();
  const content = fileIndexToString(entries);
  writeFileSync(cachePath, content, "utf-8");
  return content;
}
```

**Step 2: Test it manually**

Run: `cd /Users/rob/code/surveyor && npx tsx -e "const {generateFileIndex,fileIndexToString} = require('./scripts/feedback-agent/file-index'); console.log(fileIndexToString(generateFileIndex()).split('\n').length + ' files indexed')"`

Expected: a number like "100-300 files indexed"

**Step 3: Commit**

```bash
git add scripts/feedback-agent/file-index.ts
git commit -m "feat: add file index generator for triage prompt context"
```

---

### Task 4: Triage Prompt

**Files:**
- Create: `scripts/feedback-agent/triage-prompt.md`

**Step 1: Write the triage system prompt**

```markdown
You are a feedback triage agent for Surveyor, a web application for reviewing VDS (Valon Data Schema) field mappings.

## Your Task

Given a piece of user feedback (from Slack or Linear), classify it and generate an actionable brief.

## Output Format (JSON only, no markdown)

{
  "category": "bug" | "ux" | "data" | "feature" | "question",
  "priority": "high" | "medium" | "low",
  "confidence": 0.0-1.0,
  "summary": "one-line plain english summary of the issue",
  "suggested_approach": "what to change and where — reference specific files when possible",
  "relevant_files": ["src/path/to/file.tsx"]
}

## Priority Guidelines

- **high**: something is broken, data is wrong, or a reviewer is blocked
- **medium**: UX friction, confusing behavior, minor feature request
- **low**: nice-to-have, cosmetic, general comment

## Category Guidelines

- **bug**: something doesn't work as expected
- **ux**: works but confusing, slow, or awkward
- **data**: wrong mappings, missing data, incorrect field values
- **feature**: request for new functionality
- **question**: asking how something works (not actionable as code change)

## Non-Actionable Feedback

If the message is praise, acknowledgment, or off-topic, still classify it but set confidence to 0.0 and priority to "low".

## Surveyor File Index

The following files exist in the Surveyor codebase. Use them to populate `relevant_files`:

{{FILE_INDEX}}
```

**Step 2: Commit**

```bash
git add scripts/feedback-agent/triage-prompt.md
git commit -m "feat: add triage system prompt template"
```

---

### Task 5: Core Agent Script

**Files:**
- Create: `scripts/feedback-agent/agent.ts`

**Step 1: Build the main agent logic**

This is the core script that ties everything together: fetch → deduplicate → triage → write briefs.

```typescript
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { fetchChannelHistory, SlackMessage } from "../../src/lib/slack/gestalt-slack-client";
import { linearGql } from "../../src/lib/linear/gestalt-linear-client";
import { getOrRefreshFileIndex } from "./file-index";
import type { FeedbackBrief, AgentState, AgentConfig } from "./types";

// Load .env.local
for (const line of readFileSync(join(__dirname, "../../.env.local"), "utf-8").split("\n")) {
  const idx = line.indexOf("=");
  if (idx < 1 || line.trimStart().startsWith("#")) continue;
  process.env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/\r$/, "");
}

const config: AgentConfig = JSON.parse(
  readFileSync(join(__dirname, "../../feedback-agent.config.json"), "utf-8"),
);
const queueDir = config.queue_dir.replace("~", process.env.HOME!);
const briefsDir = join(queueDir, "briefs");
const statePath = join(queueDir, "state.json");

// Ensure directories exist
mkdirSync(briefsDir, { recursive: true });

function loadState(): AgentState {
  if (existsSync(statePath)) return JSON.parse(readFileSync(statePath, "utf-8"));
  return { last_slack_ts: null, last_linear_sync: null, processed_linear_ids: [] };
}

function saveState(state: AgentState): void {
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

// --- Fetch new feedback ---

async function fetchNewSlackMessages(state: AgentState): Promise<SlackMessage[]> {
  const oldest = state.last_slack_ts || undefined;
  const messages = await fetchChannelHistory(config.slack_channel, oldest);
  // Filter out bot messages and very short messages
  return messages.filter((m) => !m.bot_id && m.text && m.text.length > 10);
}

interface LinearComment {
  id: string;
  body: string;
  createdAt: string;
  user: { name: string };
}

interface LinearFeedbackIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  createdAt: string;
  comments: { nodes: LinearComment[] };
}

async function fetchNewLinearIssues(state: AgentState): Promise<LinearFeedbackIssue[]> {
  if (!config.linear_project_id) {
    console.warn("linear_project_id not set in config, skipping Linear fetch");
    return [];
  }
  const sinceClause = state.last_linear_sync
    ? `, createdAt: { gte: "${state.last_linear_sync}" }`
    : "";
  const query = `{
    issues(
      filter: { project: { id: { eq: "${config.linear_project_id}" } }${sinceClause} },
      first: 50,
      orderBy: createdAt
    ) {
      nodes {
        id identifier title description url createdAt
        comments { nodes { id body createdAt user { name } } }
      }
    }
  }`;
  type Resp = { issues: { nodes: LinearFeedbackIssue[] } };
  const data = await linearGql<Resp>(query);
  return data.issues.nodes.filter((i) => !state.processed_linear_ids.includes(i.id));
}

// --- Deduplication ---

interface FeedbackItem {
  source: "slack" | "linear" | "both";
  slack?: SlackMessage;
  linear?: LinearFeedbackIssue;
  text: string;
}

function deduplicateItems(
  slackMessages: SlackMessage[],
  linearIssues: LinearFeedbackIssue[],
): FeedbackItem[] {
  const items: FeedbackItem[] = [];
  const linkedLinearIds = new Set<string>();

  for (const msg of slackMessages) {
    // Check if message mentions a Linear issue identifier (e.g., VAL-123)
    const linearRef = msg.text.match(/[A-Z]+-\d+/);
    if (linearRef) {
      const linked = linearIssues.find((i) => i.identifier === linearRef[0]);
      if (linked) {
        linkedLinearIds.add(linked.id);
        items.push({
          source: "both",
          slack: msg,
          linear: linked,
          text: `Slack: ${msg.text}\n\nLinear (${linked.identifier}): ${linked.title}\n${linked.description || ""}`,
        });
        continue;
      }
    }
    items.push({ source: "slack", slack: msg, text: msg.text });
  }

  for (const issue of linearIssues) {
    if (!linkedLinearIds.has(issue.id)) {
      items.push({
        source: "linear",
        linear: issue,
        text: `${issue.title}\n${issue.description || ""}`,
      });
    }
  }

  return items;
}

// --- Triage ---

async function triageItem(
  client: Anthropic,
  item: FeedbackItem,
  fileIndex: string,
): Promise<FeedbackBrief> {
  const promptTemplate = readFileSync(
    join(__dirname, "triage-prompt.md"),
    "utf-8",
  );
  const systemPrompt = promptTemplate.replace("{{FILE_INDEX}}", fileIndex);

  const response = await client.messages.create({
    model: config.triage_model,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: item.text }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const parsed = JSON.parse(text);

  return {
    id: randomUUID(),
    created_at: new Date().toISOString(),
    status: "pending",
    source: item.source,
    category: parsed.category,
    priority: parsed.priority,
    confidence: parsed.confidence,
    summary: parsed.summary,
    suggested_approach: parsed.suggested_approach,
    relevant_files: parsed.relevant_files || [],
    original_messages: {
      slack: item.slack
        ? { ts: item.slack.ts, text: item.slack.text, user: item.slack.user, permalink: item.slack.permalink }
        : undefined,
      linear: item.linear
        ? { id: item.linear.id, identifier: item.linear.identifier, title: item.linear.title, url: item.linear.url }
        : undefined,
    },
    resolved_at: null,
  };
}

// --- Main ---

async function main() {
  console.log(`[${new Date().toISOString()}] Feedback agent starting...`);

  const state = loadState();
  const anthropic = new Anthropic();
  const fileIndex = getOrRefreshFileIndex(queueDir, config.file_index_refresh_days);

  // Fetch new feedback
  const [slackMessages, linearIssues] = await Promise.all([
    fetchNewSlackMessages(state),
    fetchNewLinearIssues(state),
  ]);

  console.log(`  Found ${slackMessages.length} new Slack messages, ${linearIssues.length} new Linear issues`);

  if (slackMessages.length === 0 && linearIssues.length === 0) {
    console.log("  No new feedback. Done.");
    return;
  }

  // Deduplicate
  const items = deduplicateItems(slackMessages, linearIssues);
  console.log(`  ${items.length} items after deduplication`);

  // Triage each item
  for (const item of items) {
    try {
      const brief = await triageItem(anthropic, item, fileIndex);
      const briefPath = join(briefsDir, `${brief.id}.json`);
      writeFileSync(briefPath, JSON.stringify(brief, null, 2));
      console.log(`  Triaged: [${brief.priority}] ${brief.summary}`);
    } catch (err) {
      console.error(`  Failed to triage item:`, err);
    }
  }

  // Update state
  if (slackMessages.length > 0) {
    state.last_slack_ts = slackMessages[slackMessages.length - 1].ts;
  }
  if (linearIssues.length > 0) {
    state.last_linear_sync = new Date().toISOString();
    state.processed_linear_ids.push(...linearIssues.map((i) => i.id));
  }
  saveState(state);

  console.log(`[${new Date().toISOString()}] Done.`);
}

main().catch((err) => {
  console.error("Feedback agent failed:", err);
  process.exit(1);
});
```

**Step 2: Verify it compiles**

Run: `cd /Users/rob/code/surveyor && npx tsc --noEmit scripts/feedback-agent/agent.ts 2>&1 | head -20`

Note: There may be import resolution issues since this is a script, not part of the Next.js build. If so, add `// @ts-nocheck` temporarily and test at runtime instead.

**Step 3: Test with a dry run**

Run: `cd /Users/rob/code/surveyor && npx tsx scripts/feedback-agent/agent.ts`

Verify it connects to Slack/Linear and processes any existing messages. If the channel is empty or the Linear project ID isn't set, it should exit gracefully.

**Step 4: Commit**

```bash
git add scripts/feedback-agent/agent.ts
git commit -m "feat: add core feedback agent — fetch, deduplicate, triage, queue"
```

---

### Task 6: `/feedback` Custom Command

**Files:**
- Create: `.claude/commands/feedback.md`

**Step 1: Write the command**

```markdown
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
```

**Step 2: Commit**

```bash
mkdir -p .claude/commands
git add .claude/commands/feedback.md
git commit -m "feat: add /feedback custom command for Claude Code"
```

---

### Task 7: Launchd Scheduler

**Files:**
- Create: `scripts/feedback-agent/install-scheduler.sh`

**Step 1: Write the installer script**

This script creates the launchd plist and loads it. Run once to set up.

```bash
#!/bin/bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PLIST_NAME="com.surveyor.feedback-agent"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
LOG_DIR="$HOME/.claude/feedback-queue"
mkdir -p "$LOG_DIR"

cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_NAME}</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(which npx)</string>
        <string>tsx</string>
        <string>${REPO_DIR}/scripts/feedback-agent/agent.ts</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${REPO_DIR}</string>
    <key>StartInterval</key>
    <integer>1800</integer>
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/agent.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/agent-error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:$(dirname "$(which node)")</string>
    </dict>
</dict>
</plist>
EOF

# Unload if already loaded, then load
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"

echo "Feedback agent scheduler installed and started."
echo "  Plist: $PLIST_PATH"
echo "  Logs:  $LOG_DIR/agent.log"
echo "  Runs every 30 minutes."
echo ""
echo "To stop:   launchctl unload $PLIST_PATH"
echo "To manual: cd $REPO_DIR && npx tsx scripts/feedback-agent/agent.ts"
```

**Step 2: Commit**

```bash
git add scripts/feedback-agent/install-scheduler.sh
git commit -m "feat: add launchd installer for feedback agent scheduler"
```

---

### Task 8: End-to-End Test

**Files:** None new — this is a manual integration test.

**Step 1: Set the Linear project ID**

Run: `cd /Users/rob/code/surveyor && npx tsx -e "
for (const l of require('fs').readFileSync('.env.local','utf-8').split('\n')) { const i=l.indexOf('='); if(i>0&&!l.trim().startsWith('#')) process.env[l.slice(0,i).trim()]=l.slice(i+1).trim(); }
const {fetchAllProjectIssues} = require('./src/lib/linear/gestalt-linear-client');
// We need the project ID — check existing scripts or Linear URL
"`

Update `feedback-agent.config.json` with the correct `linear_project_id`.

**Step 2: Run the agent manually**

Run: `cd /Users/rob/code/surveyor && npx tsx scripts/feedback-agent/agent.ts`

Expected: Should print found messages/issues, triage results, and write briefs to `~/.claude/feedback-queue/briefs/`.

**Step 3: Verify briefs were written**

Run: `ls ~/.claude/feedback-queue/briefs/ && cat ~/.claude/feedback-queue/briefs/*.json | head -50`

Expected: JSON files with the triage schema.

**Step 4: Test the `/feedback` command**

Open a new Claude Code session in the surveyor directory and run `/feedback`. Verify it reads and presents the queued briefs.

**Step 5: Install the scheduler**

Run: `cd /Users/rob/code/surveyor && bash scripts/feedback-agent/install-scheduler.sh`

Verify: `launchctl list | grep surveyor`

**Step 6: Final commit**

```bash
git add feedback-agent.config.json
git commit -m "feat: complete feedback agent setup with config"
```
