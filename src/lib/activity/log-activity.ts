import { db } from "@/lib/db";
import { activity } from "@/lib/db/schema";
import type { ActivityAction } from "@/lib/constants";

interface LogActivityInput {
  workspaceId: string;
  fieldMappingId?: string | null;
  entityId?: string | null;
  actorId?: string | null;
  actorName: string;
  action: ActivityAction;
  detail?: Record<string, unknown>;
}

export function logActivity(input: LogActivityInput) {
  db.insert(activity)
    .values({
      workspaceId: input.workspaceId,
      fieldMappingId: input.fieldMappingId || null,
      entityId: input.entityId || null,
      actorId: input.actorId || null,
      actorName: input.actorName,
      action: input.action,
      detail: input.detail || null,
    })
    .run();
}
