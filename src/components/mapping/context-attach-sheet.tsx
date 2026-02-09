"use client";

import { useState, useMemo } from "react";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { useContexts } from "@/queries/context-queries";
import { Search, Plus } from "lucide-react";
import {
  CONTEXT_CATEGORIES,
  CONTEXT_CATEGORY_LABELS,
  type ContextCategory,
} from "@/lib/constants";

interface ContextAttachSheetProps {
  open: boolean;
  onClose: () => void;
  onAttach: (contextId: string) => void;
  excludeIds: Set<string>;
}

export function ContextAttachSheet({
  open,
  onClose,
  onAttach,
  excludeIds,
}: ContextAttachSheetProps) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<ContextCategory | "">(
    ""
  );

  const { data: contexts } = useContexts(
    category ? { category } : undefined
  );

  const filtered = useMemo(() => {
    if (!contexts) return [];
    return contexts.filter((ctx) => {
      if (excludeIds.has(ctx.id)) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          ctx.name.toLowerCase().includes(q) ||
          ctx.tags?.some((t) => t.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [contexts, excludeIds, search]);

  const handleAttach = (contextId: string) => {
    onAttach(contextId);
  };

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader>
        <h2 className="text-lg font-semibold">Attach Context</h2>
        <p className="text-sm text-muted-foreground">
          Link a context document to this mapping for traceability.
        </p>
      </SheetHeader>
      <SheetContent>
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search contexts..."
                className="w-full pl-8 pr-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <select
              value={category}
              onChange={(e) =>
                setCategory(e.target.value as ContextCategory | "")
              }
              className="text-xs border rounded-md px-2 bg-background"
            >
              <option value="">All Categories</option>
              {CONTEXT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CONTEXT_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>

          {/* Context list */}
          <div className="border rounded-md divide-y max-h-[60vh] overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground p-4 text-center">
                No matching contexts
              </p>
            ) : (
              filtered.map((ctx) => {
                const preview =
                  ctx.content.slice(0, 80) +
                  (ctx.content.length > 80 ? "..." : "");
                return (
                  <div
                    key={ctx.id}
                    className="flex items-start gap-2 p-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {ctx.name}
                      </p>
                      <p className="text-xs text-muted-foreground line-clamp-1">
                        {preview}
                      </p>
                      <div className="flex gap-1 mt-1">
                        <Badge variant="secondary" className="text-[10px]">
                          {ctx.category}
                        </Badge>
                        {ctx.tags?.slice(0, 2).map((t) => (
                          <Badge key={t} variant="outline" className="text-[10px]">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={() => handleAttach(ctx.id)}
                      className="p-1.5 rounded hover:bg-muted shrink-0"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
