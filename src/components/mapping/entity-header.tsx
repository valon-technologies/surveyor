"use client";

import { Progress } from "@/components/ui/progress";
import { EntityStatusBadge } from "@/components/shared/status-badge";
import { TierBadge } from "@/components/shared/tier-badge";
import { Select } from "@/components/ui/select";
import { useUpdateEntity } from "@/queries/entity-queries";
import { ENTITY_STATUSES, ENTITY_STATUS_LABELS, PRIORITY_TIERS } from "@/lib/constants";
import type { Entity } from "@/types/entity";
import type { FieldWithMapping } from "@/types/field";

interface EntityHeaderProps {
  entity: Entity & {
    fields: FieldWithMapping[];
    fieldCount: number;
    mappedCount: number;
    coveragePercent: number;
    openQuestions: number;
  };
}

export function EntityHeader({ entity }: EntityHeaderProps) {
  const updateEntity = useUpdateEntity();

  return (
    <div className="flex items-center gap-4 flex-1 min-w-0">
      <div className="min-w-0 flex-1">
        <h1 className="text-lg font-semibold truncate">
          {entity.displayName || entity.name}
        </h1>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>{entity.mappedCount}/{entity.fieldCount} fields</span>
          <span>({entity.coveragePercent}%)</span>
        </div>
        <Progress
          value={entity.coveragePercent}
          className="w-24"
          indicatorClassName="bg-emerald-500"
        />

        <Select
          value={entity.priorityTier || ""}
          onChange={(e) =>
            updateEntity.mutate({
              id: entity.id,
              priorityTier: e.target.value || null,
            })
          }
          options={[
            { value: "", label: "No Tier" },
            ...PRIORITY_TIERS.map((t) => ({ value: t, label: t })),
          ]}
          className="w-24"
        />

        <Select
          value={entity.status}
          onChange={(e) =>
            updateEntity.mutate({ id: entity.id, status: e.target.value })
          }
          options={ENTITY_STATUSES.map((s) => ({
            value: s,
            label: ENTITY_STATUS_LABELS[s],
          }))}
          className="w-36"
        />
      </div>
    </div>
  );
}
