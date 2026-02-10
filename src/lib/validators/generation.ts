import { z } from "zod/v4";
import { GENERATION_TYPES } from "@/lib/constants";

export const createGenerationSchema = z.object({
  entityId: z.string().min(1, "Entity ID is required"),
  fieldIds: z.array(z.string()).optional(),
  generationType: z.enum(GENERATION_TYPES),
  preferredProvider: z.enum(["claude", "openai"]).optional(),
  model: z.string().optional(),
});

export type CreateGenerationInput = z.infer<typeof createGenerationSchema>;
