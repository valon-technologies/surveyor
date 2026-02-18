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

export const excludeMappingSchema = z.object({
  reason: z.string().optional().default(""),
});

export const batchExcludeSchema = z.object({
  mappingIds: z.array(z.string()).min(1),
  reason: z.string().optional().default(""),
});

export type AcceptMappingInput = z.infer<typeof acceptMappingSchema>;
export type PuntMappingInput = z.infer<typeof puntMappingSchema>;
export type ExcludeMappingInput = z.infer<typeof excludeMappingSchema>;
export type BatchExcludeInput = z.infer<typeof batchExcludeSchema>;
