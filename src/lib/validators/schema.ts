import { z } from "zod/v4";
import { SCHEMA_SIDES, SCHEMA_FORMATS } from "@/lib/constants";

export const createSchemaAssetSchema = z.object({
  name: z.string().min(1, "Name is required"),
  side: z.enum(SCHEMA_SIDES),
  description: z.string().optional(),
  sourceFile: z.string().optional(),
  format: z.enum(SCHEMA_FORMATS).optional().default("csv"),
  rawContent: z.string().min(1, "Content is required"),
});

export type CreateSchemaAssetInput = z.infer<typeof createSchemaAssetSchema>;
