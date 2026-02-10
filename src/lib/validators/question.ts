import { z } from "zod/v4";
import { QUESTION_STATUSES, QUESTION_PRIORITIES, WORKSPACE_TEAMS } from "@/lib/constants";

export const createQuestionSchema = z.object({
  entityId: z.string().optional(),
  fieldId: z.string().optional(),
  question: z.string().min(1, "Question is required"),
  askedBy: z.enum(["user", "llm"]).optional().default("user"),
  priority: z.enum(QUESTION_PRIORITIES).optional(),
  targetForTeam: z.enum(WORKSPACE_TEAMS).optional(),
  fieldMappingId: z.string().optional(),
  chatSessionId: z.string().optional(),
});

export const updateQuestionSchema = z.object({
  answer: z.string().optional(),
  status: z.enum(QUESTION_STATUSES).optional(),
  answeredBy: z.string().optional(),
  priority: z.enum(QUESTION_PRIORITIES).optional(),
  targetForTeam: z.enum(WORKSPACE_TEAMS).nullable().optional(),
});

export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;
export type UpdateQuestionInput = z.infer<typeof updateQuestionSchema>;
