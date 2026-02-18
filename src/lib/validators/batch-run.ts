import { z } from "zod/v4";
import { MAPPING_STATUSES } from "@/lib/constants";

export const createBatchRunSchema = z.object({
  preferredProvider: z.enum(["claude", "openai"]).optional(),
  model: z.string().optional(),
  skipAlreadyMapped: z.boolean().optional(), // legacy — prefer includeStatuses
  includeStatuses: z.array(z.enum(MAPPING_STATUSES)).optional(),
  outputFormat: z.enum(["json", "yaml"]).optional(),
  mode: z.enum(["single-shot", "chat"]).optional().default("single-shot"),
  entityIds: z.array(z.string()).optional(),
});

export type CreateBatchRunInput = z.infer<typeof createBatchRunSchema>;
