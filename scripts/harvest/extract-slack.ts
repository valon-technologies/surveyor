/**
 * Extract mapping claims from Slack channels via Gestalt API.
 *
 * Usage:
 *   npx tsx scripts/harvest/extract-slack.ts [--dry-run] [--channel-ids C123,C456,C789]
 */

import { readFileSync } from "fs";

// Load .env.local before any other imports that read env vars
for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const idx = line.indexOf("=");
  if (idx < 1 || line.trimStart().startsWith("#")) continue;
  process.env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/\r$/, "");
}

import { gestaltGet } from "./lib/gestalt-client";
import { extractClaims } from "./lib/claim-extractor";
import { resolveEntity, resolveField, getEntityNames } from "./lib/entity-resolver";
import { saveClaims } from "./lib/store";
import type { HarvestedClaim } from "./lib/types";

// ---------------------------------------------------------------------------
// Target channels
// ---------------------------------------------------------------------------

const TARGET_CHANNELS = [
  "proj-ocean-acdc-transform",
  "systems-data-transfer",
  "proj-m1-dry-runs",
];

// ---------------------------------------------------------------------------
// Slack API types
// ---------------------------------------------------------------------------

interface SlackChannel {
  id: string;
  name: string;
}

interface SlackMessage {
  type: string;
  subtype?: string;
  text?: string;
  user?: string;
  ts: string;
}

interface ListChannelsResponse {
  channels: SlackChannel[];
  response_metadata?: { next_cursor?: string };
}

interface ChannelHistoryResponse {
  messages: SlackMessage[];
  has_more?: boolean;
  response_metadata?: { next_cursor?: string };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Parse CLI args for --channel-ids flag. */
function parseChannelIds(): string[] | null {
  const idx = process.argv.indexOf("--channel-ids");
  if (idx === -1 || idx + 1 >= process.argv.length) return null;
  return process.argv[idx + 1].split(",").filter(Boolean);
}

/** Find target channels by name, paginating through list_channels. */
async function findChannelsByName(): Promise<Map<string, string>> {
  const found = new Map<string, string>(); // name -> id
  let cursor: string | undefined;
  let page = 1;

  while (true) {
    console.log(`Listing channels (page ${page})...`);
    const params: Record<string, string> = { limit: "500" };
    if (cursor) params.cursor = cursor;

    const data = await gestaltGet<ListChannelsResponse>("slack", "list_channels", params);

    for (const ch of data.channels) {
      if (TARGET_CHANNELS.includes(ch.name)) {
        found.set(ch.name, ch.id);
        console.log(`  Found #${ch.name} -> ${ch.id}`);
      }
    }

    // Stop if we found all targets or no more pages
    if (found.size === TARGET_CHANNELS.length) break;

    const nextCursor = data.response_metadata?.next_cursor;
    if (!nextCursor) break;
    cursor = nextCursor;
    page++;
  }

  return found;
}

/** Fetch full message history for a channel, paginating with cursor. */
async function fetchChannelHistory(channelId: string, channelName: string): Promise<SlackMessage[]> {
  const allMessages: SlackMessage[] = [];
  let cursor: string | undefined;
  let page = 1;

  while (true) {
    console.log(`  Fetching history for #${channelName} (page ${page})...`);
    const params: Record<string, string> = { channel: channelId, limit: "200" };
    if (cursor) params.cursor = cursor;

    const data = await gestaltGet<ChannelHistoryResponse>("slack", "get_channel_history", params);

    allMessages.push(...data.messages);
    console.log(`    Got ${data.messages.length} messages (total: ${allMessages.length})`);

    const nextCursor = data.response_metadata?.next_cursor;
    if (!data.has_more || !nextCursor) break;
    cursor = nextCursor;
    page++;
  }

  return allMessages;
}

/** Filter to actual content messages (not joins, leaves, bot integrations, etc). */
function filterContentMessages(messages: SlackMessage[]): SlackMessage[] {
  return messages.filter((m) => {
    if (m.type !== "message") return false;
    if (!m.text || m.text.trim().length === 0) return false;
    // Skip join/leave/channel_purpose/channel_topic subtypes
    const skipSubtypes = new Set([
      "channel_join",
      "channel_leave",
      "channel_purpose",
      "channel_topic",
      "channel_name",
      "channel_archive",
      "channel_unarchive",
      "bot_add",
      "bot_remove",
      "pinned_item",
      "unpinned_item",
    ]);
    if (m.subtype && skipSubtypes.has(m.subtype)) return false;
    return true;
  });
}

/** Batch messages into windows of `size`. */
function batchMessages(messages: SlackMessage[], size: number): SlackMessage[][] {
  const batches: SlackMessage[][] = [];
  for (let i = 0; i < messages.length; i += size) {
    batches.push(messages.slice(i, i + size));
  }
  return batches;
}

/** Format a window of messages into text for the LLM. */
function formatWindow(messages: SlackMessage[], channelName: string): string {
  const lines = [`Slack channel: #${channelName}`, ""];
  for (const m of messages) {
    const user = m.user ?? "unknown";
    const date = new Date(parseFloat(m.ts) * 1000).toISOString().slice(0, 16);
    lines.push(`[${user} - ${date}] ${m.text}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const manualIds = parseChannelIds();

  // Step 1: Resolve channels
  console.log("Resolving target channels...\n");

  let channelMap: Map<string, string>; // name -> id

  const discovered = await findChannelsByName();

  if (discovered.size === TARGET_CHANNELS.length) {
    channelMap = discovered;
  } else {
    // Some channels not found via listing
    const missing = TARGET_CHANNELS.filter((n) => !discovered.has(n));
    console.log(`\nCould not find channels via listing: ${missing.join(", ")}`);

    if (manualIds) {
      console.log(`Using --channel-ids for missing channels: ${manualIds.join(", ")}`);
      channelMap = new Map(discovered);
      // Assign manual IDs to missing channels in order
      for (let i = 0; i < Math.min(missing.length, manualIds.length); i++) {
        channelMap.set(missing[i], manualIds[i]);
      }
    } else if (discovered.size > 0) {
      console.log("Proceeding with found channels only.");
      channelMap = discovered;
    } else {
      console.error(
        "\nNo target channels found. The bot/token may not have access to these channels.\n" +
          "Try passing channel IDs manually:\n" +
          "  npx tsx scripts/harvest/extract-slack.ts --channel-ids C123,C456,C789\n\n" +
          "You can find channel IDs in Slack by right-clicking a channel > View channel details > scroll to bottom.",
      );
      process.exit(1);
    }
  }

  console.log(`\nResolved ${channelMap.size} channels.\n`);

  // Step 2: Fetch message history for each channel
  const channelMessages = new Map<string, SlackMessage[]>();

  for (const [name, id] of channelMap) {
    const raw = await fetchChannelHistory(id, name);
    const filtered = filterContentMessages(raw);
    channelMessages.set(name, filtered);
    console.log(`  #${name}: ${raw.length} raw -> ${filtered.length} content messages\n`);
  }

  const totalMessages = [...channelMessages.values()].reduce((sum, msgs) => sum + msgs.length, 0);
  console.log(`Total content messages across all channels: ${totalMessages}\n`);

  if (dryRun) {
    console.log("--dry-run: skipping LLM extraction.\n");
    for (const [name, msgs] of channelMessages) {
      const windows = batchMessages(msgs, 10);
      console.log(`  #${name}: ${msgs.length} messages -> ${windows.length} windows`);
      if (msgs.length > 0) {
        const oldest = new Date(parseFloat(msgs[msgs.length - 1].ts) * 1000).toISOString().slice(0, 10);
        const newest = new Date(parseFloat(msgs[0].ts) * 1000).toISOString().slice(0, 10);
        console.log(`    Date range: ${oldest} to ${newest}`);
      }
      // Show a few sample messages
      console.log("    Sample messages:");
      for (const m of msgs.slice(0, 3)) {
        const preview = (m.text ?? "").slice(0, 100).replace(/\n/g, " ");
        console.log(`      ${preview}`);
      }
    }
    return;
  }

  // Step 3: Extract claims
  const entityNames = await getEntityNames();
  console.log(`Loaded ${entityNames.length} entity names for resolution.\n`);

  const allClaims: HarvestedClaim[] = [];
  let windowCount = 0;

  for (const [name, msgs] of channelMessages) {
    const windows = batchMessages(msgs, 10);
    console.log(`Processing #${name}: ${msgs.length} messages in ${windows.length} windows`);

    for (let w = 0; w < windows.length; w++) {
      const window = windows[w];
      const text = formatWindow(window, name);
      const firstTs = window[0].ts;
      const sourceRef = `slack:#${name}:${firstTs}`;

      console.log(`  [${w + 1}/${windows.length}] window starting at ts=${firstTs}`);

      const claims = await extractClaims(text, entityNames, "slack", sourceRef, "M1");

      // Resolve entity/field names
      for (const claim of claims) {
        if (claim.entityName) {
          const resolved = await resolveEntity(claim.entityName);
          if (resolved) claim.entityName = resolved;
        }

        if (claim.entityName && claim.fieldName) {
          const resolved = await resolveField(claim.entityName, claim.fieldName);
          if (resolved) claim.fieldName = resolved;
        }
      }

      console.log(`    -> ${claims.length} claims`);
      allClaims.push(...claims);
      windowCount++;

      // Rate limit: 1 second between LLM calls
      if (w < windows.length - 1 || name !== [...channelMessages.keys()].pop()) {
        await sleep(1000);
      }
    }

    console.log(`  Subtotal after #${name}: ${allClaims.length} claims\n`);
  }

  console.log(`\nExtraction complete. ${windowCount} windows processed, ${allClaims.length} total claims.`);
  saveClaims("slack-claims.json", allClaims);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
