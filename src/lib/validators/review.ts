import { z } from "zod/v4";
import { QUESTION_PRIORITIES } from "@/lib/constants";

export const acceptMappingSchema = z.object({
  // No fields required — accepting uses the current mapping as-is
});

export const puntMappingSchema = z.object({
  note: z.string().min(1, "A note is required when punting"),
  assignToSM: z.boolean().optional().default(false),
  questionText: z.string().optional(),
  priority: z.enum(QUESTION_PRIORITIES).optional().default("normal"),
});

export type AcceptMappingInput = z.infer<typeof acceptMappingSchema>;
export type PuntMappingInput = z.infer<typeof puntMappingSchema>;
