import type { ContextCategory, ContextSubcategory } from "@/lib/constants";

export interface Context {
  id: string;
  workspaceId: string;
  name: string;
  category: ContextCategory;
  subcategory: ContextSubcategory | null;
  entityId: string | null;
  fieldId: string | null;
  content: string;
  contentFormat: string;
  tokenCount: number | null;
  tags: string[] | null;
  isActive: boolean;
  sortOrder: number;
  importSource: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContextCreateInput {
  name: string;
  category: ContextCategory;
  subcategory?: ContextSubcategory;
  entityId?: string;
  fieldId?: string;
  content: string;
  contentFormat?: string;
  tags?: string[];
  importSource?: string;
}

export interface ContextUpdateInput {
  name?: string;
  category?: ContextCategory;
  subcategory?: ContextSubcategory | null;
  entityId?: string | null;
  fieldId?: string | null;
  content?: string;
  contentFormat?: string;
  tags?: string[];
  isActive?: boolean;
  sortOrder?: number;
}
