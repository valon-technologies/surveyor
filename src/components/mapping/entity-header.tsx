"use client";

import { Sparkles } from "lucide-react";
import { EntityStatusBadge } from "@/components/shared/status-badge";
import { useMappingStore } from "@/stores/mapping-store";
import {
  MAPPING_STATUS_COLORS,
  MAPPING_STATUS_LABELS,
  type MappingStatus,
} from "@/lib/constants";
import type { Entity } from "@/types/entity";
import type { FieldWithMapping } from "@/types/field";

const STATUS_ORDER: MappingStatus[] = [
  "fully_closed",
  "excluded",
  "pending",
  "open_comment_sm",
  "open_comment_vt",
  "unmapped",
];

interface EntityHeaderProps {
  entity: Entity & {
    fields: FieldWithMapping[];
    fieldCount: number;
    mappedCount: number;
    coveragePercent: number;
    openQuestions: number;
    statusBreakdown?: Record<string, number>;
  };
}

export function EntityHeader({ entity }: EntityHeaderProps) {
  const { setAutoMapSheetOpen } = useMappingStore();

  const unmappedCount = entity.fieldCount - entity.mappedCount;

  return (
    <div className="flex items-center gap-4 flex-1 min-w-0">
      <div className="min-w-0 flex-1">
        <h1 className="text-lg font-semibold truncate">
          {entity.displayName || entity.name}
        </h1>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {unmappedCount > 0 && (
          <button
            onClick={() => setAutoMapSheetOpen(true)}
            className="relative overflow-hidden rounded-md border border-purple-300 dark:border-purple-700 bg-gradient-to-r from-purple-50 via-white to-purple-50 dark:from-purple-950/40 dark:via-purple-950/20 dark:to-purple-950/40 h-8 px-3 text-xs font-medium text-purple-700 dark:text-purple-300 shadow-sm transition-all hover:border-purple-400 hover:shadow-purple-200/50 dark:hover:border-purple-600 dark:hover:shadow-purple-900/30 hover:shadow-md group"
          >
            <span className="absolute inset-0 bg-gradient-to-r from-transparent via-purple-200/40 to-transparent dark:via-purple-400/10 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 ease-in-out" />
            <span className="relative flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              Auto-Map ({unmappedCount})
            </span>
          </button>
        )}

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>
            {entity.mappedCount}/{entity.fieldCount} fields
          </span>
          <span>({entity.coveragePercent}%)</span>
        </div>

        {entity.statusBreakdown && entity.fieldCount > 0 && (
          <div className="flex h-2 w-24 rounded-full overflow-hidden bg-muted">
            {STATUS_ORDER.map((status) => {
              const count = entity.statusBreakdown![status] || 0;
              if (count === 0) return null;
              const pct = (count / entity.fieldCount) * 100;
              return (
                <div
                  key={status}
                  className="h-full transition-all"
                  style={{
                    width: `${pct}%`,
                    backgroundColor:
                      MAPPING_STATUS_COLORS[status] || "#6b7280",
                  }}
                  title={`${MAPPING_STATUS_LABELS[status] || status}: ${count}`}
                />
              );
            })}
          </div>
        )}

        <EntityStatusBadge status={entity.status} />
      </div>
    </div>
  );
}
