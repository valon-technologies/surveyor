import { z } from "zod/v4";

export const createBatchRunSchema = z.object({
  preferredProvider: z.enum(["claude", "openai"]).optional(),
  model: z.string().optional(),
  skipAlreadyMapped: z.boolean().optional().default(true),
});

export type CreateBatchRunInput = z.infer<typeof createBatchRunSchema>;
