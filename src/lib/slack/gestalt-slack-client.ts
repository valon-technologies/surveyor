/**
 * Fetch-based Gestalt Slack client.
 * Uses GESTALT_API_KEY env var to authenticate against the Gestalt API.
 */

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

/** Build a GET URL with query params */
function gestaltGet(path: string, params: Record<string, string | number>): string {
  const url = new URL(`${GESTALT_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

const authHeaders = () => ({ Authorization: `Bearer ${getApiKey()}` });

/** Resolve a channel name to its ID via search (handles private channels) */
export async function resolveChannelId(channelName: string): Promise<string> {
  const name = channelName.replace(/^#/, "");
  // Try list_channels with both public and private types
  const res = await fetch(
    gestaltGet("/slack/list_channels", { limit: 200, types: "public_channel,private_channel" }),
    { headers: authHeaders() },
  );
  if (!res.ok) throw new Error(`Gestalt Slack list_channels failed: ${await res.text()}`);
  const json = await res.json();
  const channels = json.data?.channels || json.channels || [];
  const match = channels.find((c: { name: string }) => c.name === name);
  if (match) return match.id;

  // Fallback: use search_messages to find the channel
  const searchRes = await fetch(
    gestaltGet("/slack/search_messages", { query: `in:${name}`, count: 1 }),
    { headers: authHeaders() },
  );
  if (searchRes.ok) {
    const searchJson = await searchRes.json();
    const firstMatch = searchJson.data?.matches?.[0];
    if (firstMatch?.channel?.id) return firstMatch.channel.id;
  }

  throw new Error(`Channel ${channelName} not found`);
}

/** Fetch channel history from Slack via Gestalt.
 *  Accepts a channel name (#channel-name) or a Slack channel ID (C...). */
export async function fetchChannelHistory(
  channelNameOrId: string,
  oldest?: string,
): Promise<SlackMessage[]> {
  // If it looks like a Slack channel ID, use it directly
  const channelId = /^C[A-Z0-9]+$/.test(channelNameOrId)
    ? channelNameOrId
    : await resolveChannelId(channelNameOrId);

  const params: Record<string, string | number> = { channel: channelId, limit: 100 };
  if (oldest) params.oldest = oldest;

  const historyRes = await fetch(
    gestaltGet("/slack/get_channel_history", params),
    { headers: authHeaders() },
  );
  if (!historyRes.ok) throw new Error(`Gestalt Slack history failed: ${await historyRes.text()}`);
  const json = await historyRes.json();
  const data: SlackHistoryResponse = json.data || json;
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
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`Gestalt Slack send_message failed: ${await res.text()}`);
}
