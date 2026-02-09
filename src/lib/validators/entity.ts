import { z } from "zod/v4";
import { ENTITY_STATUSES, PRIORITY_TIERS } from "@/lib/constants";

export const updateEntitySchema = z.object({
  displayName: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(ENTITY_STATUSES).optional(),
  priorityTier: z.enum(PRIORITY_TIERS).nullable().optional(),
  sortOrder: z.number().int().optional(),
});

export type UpdateEntityInput = z.infer<typeof updateEntitySchema>;
