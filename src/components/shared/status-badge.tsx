"use client";

import { Badge } from "@/components/ui/badge";
import {
  MAPPING_STATUS_COLORS,
  MAPPING_STATUS_LABELS,
  MAPPING_STATUS_DESCRIPTIONS,
  ENTITY_STATUS_COLORS,
  ENTITY_STATUS_LABELS,
  type MappingStatus,
  type EntityStatus,
} from "@/lib/constants";

export function MappingStatusBadge({ status }: { status: string }) {
  const color = MAPPING_STATUS_COLORS[status as MappingStatus] || "#6b7280";
  const label = MAPPING_STATUS_LABELS[status as MappingStatus] || status;
  const tooltip = MAPPING_STATUS_DESCRIPTIONS[status as MappingStatus];

  return (
    <Badge
      className="text-white border-0"
      style={{ backgroundColor: color }}
      title={tooltip}
    >
      {label}
    </Badge>
  );
}

export function EntityStatusBadge({ status }: { status: string }) {
  const color = ENTITY_STATUS_COLORS[status as EntityStatus] || "#6b7280";
  const label = ENTITY_STATUS_LABELS[status as EntityStatus] || status;

  return (
    <Badge
      className="text-white border-0"
      style={{ backgroundColor: color }}
    >
      {label}
    </Badge>
  );
}
