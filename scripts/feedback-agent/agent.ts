import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { fetchChannelHistory, sendSlackMessage, SlackMessage } from "../../src/lib/slack/gestalt-slack-client";
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
  // Prefer channel ID from config to avoid list_channels API call
  const channelRef = (config as any).slack_channel_id || config.slack_channel;
  const messages = await fetchChannelHistory(channelRef, oldest);
  const notifyUser = (config as any).notify_slack_user;
  // Filter out bot messages, very short messages, and own replies (fixes, not feedback)
  return messages.filter((m: any) =>
    !m.bot_id && !m.subtype && m.text && m.text.length > 10 && m.user !== notifyUser
  );
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

  const rawText = response.content[0].type === "text" ? response.content[0].text : "";
  // Strip markdown fences if present (```json ... ```)
  const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
  const text = jsonMatch ? jsonMatch[1].trim() : rawText.trim();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    // If model returned prose instead of JSON, treat as non-actionable
    console.warn(`  Non-JSON response, skipping: "${rawText.slice(0, 60)}..."`);
    return {
      id: randomUUID(),
      created_at: new Date().toISOString(),
      status: "pending",
      source: item.source,
      category: "question" as const,
      priority: "low" as const,
      confidence: 0,
      summary: rawText.slice(0, 100),
      suggested_approach: "",
      relevant_files: [],
      original_messages: {
        slack: item.slack ? { ts: item.slack.ts, text: item.slack.text, user: item.slack.user, permalink: item.slack.permalink } : undefined,
        linear: item.linear ? { id: item.linear.id, identifier: item.linear.identifier, title: item.linear.title, url: item.linear.url } : undefined,
      },
      resolved_at: null,
    };
  }

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
  const triaged: FeedbackBrief[] = [];
  for (const item of items) {
    try {
      const brief = await triageItem(anthropic, item, fileIndex);
      const briefPath = join(briefsDir, `${brief.id}.json`);
      writeFileSync(briefPath, JSON.stringify(brief, null, 2));
      console.log(`  Triaged: [${brief.priority}] ${brief.summary}`);
      triaged.push(brief);
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

  // Notify in the feedback channel
  const notifyChannel = (config as any).slack_channel_id || config.slack_channel;
  const actionable = triaged.filter((b) => b.confidence >= 0.1);
  if (actionable.length > 0) {
    const priorityEmoji = { high: "🔴", medium: "🟡", low: "🟢" } as const;
    const lines = actionable
      .sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2 };
        return order[a.priority] - order[b.priority];
      })
      .map((b) => `${priorityEmoji[b.priority]} [${b.category}] ${b.summary}`);
    const msg = `🤖 *Feedback Agent:* ${actionable.length} new item${actionable.length > 1 ? "s" : ""}\n\n${lines.join("\n")}`;
    try {
      await sendSlackMessage(notifyChannel, msg);
      console.log(`  Posted summary to ${notifyChannel}`);
    } catch (err) {
      console.error(`  Failed to send Slack notification:`, err);
    }
  }

  console.log(`[${new Date().toISOString()}] Done.`);
}

main().catch((err) => {
  console.error("Feedback agent failed:", err);
  process.exit(1);
});
