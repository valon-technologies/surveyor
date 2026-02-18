import { z } from "zod/v4";
import { QUESTION_PRIORITIES, WORKSPACE_TEAMS } from "@/lib/constants";

export const createQuestionSchema = z.object({
  entityId: z.string().optional(),
  fieldId: z.string().optional(),
  question: z.string().min(1, "Question is required"),
  askedBy: z.enum(["user", "llm"]).optional().default("user"),
  priority: z.enum(QUESTION_PRIORITIES).optional(),
  targetForTeam: z.enum(WORKSPACE_TEAMS).optional(),
  fieldMappingId: z.string().optional(),
  chatSessionId: z.string().optional(),
  assigneeIds: z.array(z.string()).optional(),
});

export const updateQuestionSchema = z.object({
  status: z.literal("dismissed").optional(),
  priority: z.enum(QUESTION_PRIORITIES).optional(),
  targetForTeam: z.enum(WORKSPACE_TEAMS).nullable().optional(),
  schemaAssetIds: z.array(z.string()).nullable().optional(),
  assigneeIds: z.array(z.string()).nullable().optional(),
});

export const createQuestionReplySchema = z.object({
  body: z.string().min(1, "Reply body is required"),
});

export const resolveQuestionSchema = z.object({
  body: z.string().optional(),
});

export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;
export type UpdateQuestionInput = z.infer<typeof updateQuestionSchema>;
export type CreateQuestionReplyInput = z.infer<typeof createQuestionReplySchema>;
export type ResolveQuestionInput = z.infer<typeof resolveQuestionSchema>;
