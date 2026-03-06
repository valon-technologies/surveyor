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

/** Fetch channel history from Slack via Gestalt */
export async function fetchChannelHistory(
  channelName: string,
  oldest?: string,
): Promise<SlackMessage[]> {
  // First, resolve channel name to ID
  const channelsRes = await fetch(
    gestaltGet("/slack/list_channels", { limit: 200 }),
    { headers: authHeaders() },
  );
  if (!channelsRes.ok) throw new Error(`Gestalt Slack list_channels failed: ${await channelsRes.text()}`);
  const channelsData = await channelsRes.json();
  const channel = channelsData.channels?.find(
    (c: { name: string }) => c.name === channelName.replace(/^#/, ""),
  );
  if (!channel) throw new Error(`Channel ${channelName} not found`);

  // Fetch history
  const params: Record<string, string | number> = { channel: channel.id, limit: 100 };
  if (oldest) params.oldest = oldest;

  const historyRes = await fetch(
    gestaltGet("/slack/get_channel_history", params),
    { headers: authHeaders() },
  );
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
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`Gestalt Slack send_message failed: ${await res.text()}`);
}
