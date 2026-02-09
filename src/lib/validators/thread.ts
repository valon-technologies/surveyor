import { z } from "zod/v4";
import { THREAD_STATUSES } from "@/lib/constants";

export const createThreadSchema = z.object({
  entityId: z.string().optional(),
  fieldMappingId: z.string().optional(),
  subject: z.string().optional(),
  createdBy: z.string().min(1, "Author name is required"),
  body: z.string().min(1, "Comment body is required"),
  bodyFormat: z.string().optional().default("markdown"),
});

export const createCommentSchema = z.object({
  authorName: z.string().min(1, "Author name is required"),
  body: z.string().min(1, "Comment body is required"),
  bodyFormat: z.string().optional().default("markdown"),
});

export const updateThreadSchema = z.object({
  subject: z.string().optional(),
  status: z.enum(THREAD_STATUSES).optional(),
  resolvedBy: z.string().optional(),
});

export const updateCommentSchema = z.object({
  body: z.string().min(1, "Comment body is required"),
});

export type CreateThreadInput = z.infer<typeof createThreadSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type UpdateThreadInput = z.infer<typeof updateThreadSchema>;
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;
