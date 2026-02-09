"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { TagBadge } from "@/components/shared/tag-badge";
import {
  CONTEXT_SUBCATEGORY_LABELS,
  type ContextSubcategory,
} from "@/lib/constants";
import type { Context } from "@/types/context";

interface ContextCardProps {
  context: Context;
}

export function ContextCard({ context: ctx }: ContextCardProps) {
  const subcategoryLabel = ctx.subcategory
    ? CONTEXT_SUBCATEGORY_LABELS[ctx.subcategory as ContextSubcategory]
    : null;

  const preview = ctx.content.slice(0, 120) + (ctx.content.length > 120 ? "..." : "");

  return (
    <Link
      href={`/context/${ctx.id}`}
      className="block border rounded-lg p-4 hover:border-primary/50 hover:bg-muted/30 transition-colors"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h4 className="font-medium text-sm truncate">{ctx.name}</h4>
        {!ctx.isActive && (
          <Badge variant="secondary" className="text-[10px] shrink-0">
            Inactive
          </Badge>
        )}
      </div>

      {subcategoryLabel && (
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">
          {subcategoryLabel}
        </p>
      )}

      <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{preview}</p>

      <div className="flex flex-wrap gap-1">
        {ctx.tags?.map((tag) => (
          <TagBadge key={tag} tag={tag} />
        ))}
      </div>
    </Link>
  );
}
