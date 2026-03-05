"use client";

import { useRef, useCallback, useEffect } from "react";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { trackEvent, type AnalyticsEventName } from "./track-event";

/**
 * Hook for tracking review session analytics on the discuss page.
 * Automatically tracks review_started on mount and review_abandoned on unmount
 * (if review was not explicitly submitted).
 */
export function useReviewAnalytics(fieldMappingId: string, entityId?: string) {
  const { workspaceId } = useWorkspace();
  const startTimeRef = useRef<number>(Date.now());
  const submittedRef = useRef(false);

  const track = useCallback(
    (eventName: AnalyticsEventName, extra?: { durationMs?: number; properties?: Record<string, unknown> }) => {
      trackEvent({
        workspaceId,
        eventName,
        fieldMappingId,
        entityId,
        ...extra,
      });
    },
    [workspaceId, fieldMappingId, entityId]
  );

  // Track review_started on mount
  useEffect(() => {
    startTimeRef.current = Date.now();
    submittedRef.current = false;
    track("review_started");

    return () => {
      if (!submittedRef.current) {
        const durationMs = Date.now() - startTimeRef.current;
        track("review_abandoned", { durationMs });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldMappingId]);

  const trackSubmitted = useCallback(() => {
    submittedRef.current = true;
    const durationMs = Date.now() - startTimeRef.current;
    track("review_submitted", { durationMs });
  }, [track]);

  const trackSuggestionAccepted = useCallback(
    (card: "source" | "transform") => {
      track("ai_suggestion_accepted", { properties: { card } });
    },
    [track]
  );

  const trackSuggestionOverridden = useCallback(
    (card: "source" | "transform") => {
      track("ai_suggestion_overridden", { properties: { card } });
    },
    [track]
  );

  const trackWhyWrongProvided = useCallback(
    (card: "source" | "transform") => {
      track("why_wrong_provided", { properties: { card } });
    },
    [track]
  );

  const trackChatSent = useCallback(() => {
    track("ai_chat_sent");
  }, [track]);

  const trackChatChangedMind = useCallback(() => {
    track("ai_chat_changed_mind");
  }, [track]);

  return {
    trackSubmitted,
    trackSuggestionAccepted,
    trackSuggestionOverridden,
    trackWhyWrongProvided,
    trackChatSent,
    trackChatChangedMind,
  };
}
