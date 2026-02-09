import type { SkillContextRole } from "@/lib/constants";
import type { Context } from "./context";

export interface Skill {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  instructions: string | null;
  applicability: {
    entityPatterns?: string[];
    fieldPatterns?: string[];
    dataTypes?: string[];
    subcategories?: string[];
  } | null;
  tags: string[] | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface SkillContext {
  id: string;
  skillId: string;
  contextId: string;
  role: SkillContextRole;
  sortOrder: number;
  notes: string | null;
  createdAt: string;
}

export interface SkillContextWithDetail extends SkillContext {
  context: Context;
}

export interface SkillWithContexts extends Skill {
  contexts: SkillContextWithDetail[];
}

export interface SkillWithCount extends Skill {
  contextCount: number;
}

export interface SkillCreateInput {
  name: string;
  description?: string;
  instructions?: string;
  applicability?: {
    entityPatterns?: string[];
    fieldPatterns?: string[];
    dataTypes?: string[];
    subcategories?: string[];
  };
  tags?: string[];
}

export interface SkillUpdateInput {
  name?: string;
  description?: string | null;
  instructions?: string | null;
  applicability?: {
    entityPatterns?: string[];
    fieldPatterns?: string[];
    dataTypes?: string[];
    subcategories?: string[];
  } | null;
  tags?: string[];
  isActive?: boolean;
  sortOrder?: number;
}

export interface SkillContextInput {
  contextId: string;
  role?: SkillContextRole;
  sortOrder?: number;
  notes?: string;
}
