import { db } from "@/lib/db";
import { feedbackEvent } from "@/lib/db/schema";

export type FeedbackEventType =
  | "verdict_submitted"
  | "learning_created"
  | "entity_knowledge_rebuilt"
  | "context_assembled"
  | "sot_evaluated";

export function emitFeedbackEvent(input: {
  workspaceId: string;
  entityId: string;
  fieldMappingId?: string;
  eventType: FeedbackEventType;
  payload: Record<string, unknown>;
  correlationId?: string;
}): string {
  const [row] = db
    .insert(feedbackEvent)
    .values({
      workspaceId: input.workspaceId,
      entityId: input.entityId,
      fieldMappingId: input.fieldMappingId ?? null,
      eventType: input.eventType,
      payload: input.payload,
      correlationId: input.correlationId ?? null,
    })
    .returning({ id: feedbackEvent.id })
    .all();

  return row.id;
}
