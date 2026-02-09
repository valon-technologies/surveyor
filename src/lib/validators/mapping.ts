import { z } from "zod/v4";
import { MAPPING_STATUSES, CONFIDENCE_LEVELS } from "@/lib/constants";

export const createMappingSchema = z.object({
  targetFieldId: z.string().min(1),
  status: z.enum(MAPPING_STATUSES),
  sourceEntityId: z.string().optional(),
  sourceFieldId: z.string().optional(),
  transform: z.string().optional(),
  defaultValue: z.string().optional(),
  enumMapping: z.record(z.string(), z.string()).optional(),
  reasoning: z.string().optional(),
  confidence: z.enum(CONFIDENCE_LEVELS).optional(),
  notes: z.string().optional(),
  createdBy: z.enum(["manual", "llm", "import"]).optional().default("manual"),
});

export const updateMappingSchema = z.object({
  status: z.enum(MAPPING_STATUSES).optional(),
  sourceEntityId: z.string().nullable().optional(),
  sourceFieldId: z.string().nullable().optional(),
  transform: z.string().nullable().optional(),
  defaultValue: z.string().nullable().optional(),
  enumMapping: z.record(z.string(), z.string()).nullable().optional(),
  reasoning: z.string().nullable().optional(),
  confidence: z.enum(CONFIDENCE_LEVELS).nullable().optional(),
  notes: z.string().nullable().optional(),
  editedBy: z.string().optional(),
});

export const bulkCreateMappingsSchema = z.object({
  mappings: z.array(createMappingSchema),
  generationId: z.string().optional(),
});

export const addMappingContextSchema = z.object({
  contextId: z.string().min(1, "Context ID is required"),
  contextType: z.enum(["context_reference", "sample_data", "qa_answer", "validation_result", "manual_note"]).optional().default("context_reference"),
  excerpt: z.string().optional(),
  relevance: z.string().optional(),
});

export type CreateMappingInput = z.infer<typeof createMappingSchema>;
export type UpdateMappingInput = z.infer<typeof updateMappingSchema>;
export type BulkCreateMappingsInput = z.infer<typeof bulkCreateMappingsSchema>;
export type AddMappingContextInput = z.infer<typeof addMappingContextSchema>;
