import { z } from "zod/v4";
import { ENTITY_STATUSES } from "@/lib/constants";

export const updateEntitySchema = z.object({
  displayName: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(ENTITY_STATUSES).optional(),
  sortOrder: z.number().int().optional(),
});

export type UpdateEntityInput = z.infer<typeof updateEntitySchema>;
