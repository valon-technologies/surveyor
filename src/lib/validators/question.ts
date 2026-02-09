import { z } from "zod/v4";
import { QUESTION_STATUSES } from "@/lib/constants";

export const createQuestionSchema = z.object({
  entityId: z.string().optional(),
  fieldId: z.string().optional(),
  question: z.string().min(1, "Question is required"),
  askedBy: z.enum(["user", "llm"]).optional().default("user"),
});

export const updateQuestionSchema = z.object({
  answer: z.string().optional(),
  status: z.enum(QUESTION_STATUSES).optional(),
  answeredBy: z.string().optional(),
});

export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;
export type UpdateQuestionInput = z.infer<typeof updateQuestionSchema>;
