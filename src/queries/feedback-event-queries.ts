import { useQuery } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { useWorkspace } from "@/lib/hooks/use-workspace";

export interface FeedbackEvent {
  id: string;
  workspaceId: string;
  entityId: string;
  fieldMappingId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  correlationId: string | null;
  createdAt: string;
}

interface FeedbackEventsResponse {
  events: FeedbackEvent[];
}

export function useFeedbackEvents(entityId: string | null) {
  const { workspaceId } = useWorkspace();

  return useQuery({
    queryKey: ["feedback-events", workspaceId, entityId],
    queryFn: () =>
      api.get<FeedbackEventsResponse>(
        workspacePath(workspaceId, "feedback-events"),
        { entityId: entityId! },
      ),
    enabled: !!entityId && !!workspaceId,
    select: (data) => data.events,
  });
}
