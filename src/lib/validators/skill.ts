import { z } from "zod/v4";
import { SKILL_CONTEXT_ROLES } from "@/lib/constants";

export const createSkillSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  instructions: z.string().optional(),
  applicability: z
    .object({
      entityPatterns: z.array(z.string()).optional(),
      fieldPatterns: z.array(z.string()).optional(),
      dataTypes: z.array(z.string()).optional(),
      subcategories: z.array(z.string()).optional(),
    })
    .optional(),
  tags: z.array(z.string()).optional(),
});

export const updateSkillSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  instructions: z.string().nullable().optional(),
  applicability: z
    .object({
      entityPatterns: z.array(z.string()).optional(),
      fieldPatterns: z.array(z.string()).optional(),
      dataTypes: z.array(z.string()).optional(),
      subcategories: z.array(z.string()).optional(),
    })
    .nullable()
    .optional(),
  tags: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const addSkillContextSchema = z.object({
  contextId: z.string().min(1, "Context ID is required"),
  role: z.enum(SKILL_CONTEXT_ROLES).optional().default("reference"),
  sortOrder: z.number().int().optional().default(0),
  notes: z.string().optional(),
});

export const updateSkillContextSchema = z.object({
  role: z.enum(SKILL_CONTEXT_ROLES).optional(),
  sortOrder: z.number().int().optional(),
  notes: z.string().nullable().optional(),
});

export type CreateSkillInput = z.infer<typeof createSkillSchema>;
export type UpdateSkillInput = z.infer<typeof updateSkillSchema>;
export type AddSkillContextInput = z.infer<typeof addSkillContextSchema>;
export type UpdateSkillContextInput = z.infer<typeof updateSkillContextSchema>;
