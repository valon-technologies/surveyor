import { z } from "zod/v4";
import { CONTEXT_CATEGORIES } from "@/lib/constants";

const ALL_SUBCATEGORIES = [
  "domain_knowledge", "business_rules", "glossary",
  "code_breaker", "lookup_table", "enum_map", "data_dictionary", "field_spec",
  "meeting_notes", "transcript", "extract", "working_doc",
] as const;

export const createContextSchema = z.object({
  name: z.string().min(1, "Name is required"),
  category: z.enum(CONTEXT_CATEGORIES),
  subcategory: z.enum(ALL_SUBCATEGORIES).optional(),
  entityId: z.string().optional(),
  fieldId: z.string().optional(),
  content: z.string().min(1, "Content is required"),
  contentFormat: z.string().optional().default("markdown"),
  tags: z.array(z.string()).optional(),
  importSource: z.string().optional(),
});

export const updateContextSchema = z.object({
  name: z.string().min(1).optional(),
  category: z.enum(CONTEXT_CATEGORIES).optional(),
  subcategory: z.enum(ALL_SUBCATEGORIES).nullable().optional(),
  entityId: z.string().nullable().optional(),
  fieldId: z.string().nullable().optional(),
  content: z.string().optional(),
  contentFormat: z.string().optional(),
  tags: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export type CreateContextInput = z.infer<typeof createContextSchema>;
export type UpdateContextInput = z.infer<typeof updateContextSchema>;
