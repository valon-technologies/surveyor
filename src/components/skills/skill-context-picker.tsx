"use client";

import { useState, useMemo } from "react";
import { useContexts } from "@/queries/context-queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Search, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CONTEXT_CATEGORIES,
  CONTEXT_CATEGORY_LABELS,
  SKILL_CONTEXT_ROLES,
  SKILL_CONTEXT_ROLE_LABELS,
  type ContextCategory,
  type SkillContextRole,
} from "@/lib/constants";
import type { SkillContextWithDetail } from "@/types/skill";

interface SkillContextPickerProps {
  skillId: string;
  existingContexts: SkillContextWithDetail[];
  onAdd: (contextId: string, role: SkillContextRole) => void;
  onRemove: (scId: string) => void;
}

export function SkillContextPicker({
  skillId,
  existingContexts,
  onAdd,
  onRemove,
}: SkillContextPickerProps) {
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<ContextCategory | "">(
    ""
  );
  const [addRole, setAddRole] = useState<SkillContextRole>("reference");

  const { data: allContexts } = useContexts(
    filterCategory ? { category: filterCategory } : undefined
  );

  const existingIds = new Set(existingContexts.map((ec) => ec.contextId));

  const available = useMemo(() => {
    if (!allContexts) return [];
    return allContexts.filter((ctx) => {
      if (existingIds.has(ctx.id)) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          ctx.name.toLowerCase().includes(q) ||
          ctx.tags?.some((t) => t.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [allContexts, existingIds, search]);

  return (
    <div className="space-y-4">
      {/* Existing contexts */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Included Contexts ({existingContexts.length})
        </h4>
        {existingContexts.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No contexts added yet.
          </p>
        ) : (
          <div className="space-y-1">
            {existingContexts.map((sc) => (
              <div
                key={sc.id}
                className="flex items-center gap-2 py-1.5 px-2 rounded border text-sm"
              >
                <span className="truncate flex-1">
                  {sc.context?.name || "Unknown"}
                </span>
                <Badge variant="outline" className="text-[10px] shrink-0">
                  {SKILL_CONTEXT_ROLE_LABELS[sc.role]}
                </Badge>
                <button
                  onClick={() => onRemove(sc.id)}
                  className="p-0.5 rounded hover:bg-muted shrink-0"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add contexts */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Add Context
        </h4>
        <div className="flex gap-2 mb-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full pl-8 pr-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <select
            value={filterCategory}
            onChange={(e) =>
              setFilterCategory(e.target.value as ContextCategory | "")
            }
            className="text-xs border rounded-md px-2 bg-background"
          >
            <option value="">All</option>
            {CONTEXT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CONTEXT_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          <select
            value={addRole}
            onChange={(e) =>
              setAddRole(e.target.value as SkillContextRole)
            }
            className="text-xs border rounded-md px-2 bg-background"
          >
            {SKILL_CONTEXT_ROLES.map((r) => (
              <option key={r} value={r}>
                {SKILL_CONTEXT_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>

        <div className="max-h-60 overflow-y-auto border rounded-md divide-y">
          {available.length === 0 ? (
            <p className="text-xs text-muted-foreground p-3 text-center">
              No matching contexts
            </p>
          ) : (
            available.map((ctx) => (
              <div
                key={ctx.id}
                className="flex items-center gap-2 py-1.5 px-3 hover:bg-muted/50 transition-colors"
              >
                <span className="text-sm truncate flex-1">{ctx.name}</span>
                <Badge variant="secondary" className="text-[10px] shrink-0">
                  {ctx.category}
                </Badge>
                <button
                  onClick={() => onAdd(ctx.id, addRole)}
                  className="p-1 rounded hover:bg-muted shrink-0"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
