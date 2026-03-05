/**
 * Client-side analytics event emitter.
 * Fire-and-forget — never blocks UI or throws.
 */

export type AnalyticsEventName =
  | "review_started"
  | "review_submitted"
  | "review_abandoned"
  | "session_duration"
  | "ai_suggestion_accepted"
  | "ai_suggestion_overridden"
  | "why_wrong_provided"
  | "ai_chat_sent"
  | "ai_chat_changed_mind";

interface TrackEventOptions {
  workspaceId: string;
  eventName: AnalyticsEventName;
  fieldMappingId?: string;
  entityId?: string;
  sessionId?: string;
  durationMs?: number;
  properties?: Record<string, unknown>;
}

export function trackEvent(opts: TrackEventOptions): void {
  const { workspaceId, ...body } = opts;
  // Fire-and-forget: don't await, don't throw
  fetch(`/api/workspaces/${workspaceId}/analytics/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {
    // Silently ignore tracking failures
  });
}
