"use client";

import { cn } from "@/lib/utils";
import { MappingStatusBadge } from "@/components/shared/status-badge";
import type { FieldWithMapping } from "@/types/field";

interface FieldRowProps {
  field: FieldWithMapping;
  isSelected: boolean;
  onClick: () => void;
  openThreadCount?: number;
}

export function FieldRow({ field, isSelected, onClick, openThreadCount }: FieldRowProps) {
  const mapping = field.mapping;
  const status = mapping?.status || "unmapped";

  let sourcePreview = "";
  if (mapping?.sourceFieldName) {
    sourcePreview = mapping.sourceEntityName
      ? `${mapping.sourceEntityName}.${mapping.sourceFieldName}`
      : mapping.sourceFieldName;
  }
  if (mapping?.transform) {
    sourcePreview = mapping.transform;
  }
  if (mapping?.defaultValue) {
    sourcePreview = `DEFAULT: ${mapping.defaultValue}`;
  }

  return (
    <tr
      onClick={onClick}
      className={cn(
        "border-b cursor-pointer transition-colors text-sm",
        isSelected ? "bg-primary/5" : "hover:bg-muted/30"
      )}
    >
      <td className="px-4 py-2.5">
        <span className="font-mono text-xs">{field.name}</span>
        {field.isKey && (
          <span className="ml-1.5 text-xs text-amber-600 font-medium">PK</span>
        )}
        {field.enumValues && field.enumValues.length > 0 && (
          <span className="ml-1.5 text-[10px] text-violet-500 font-medium" title={field.enumValues.join(", ")}>
            ENUM({field.enumValues.length})
          </span>
        )}
        {openThreadCount != null && openThreadCount > 0 && (
          <span className="ml-1.5 inline-flex items-center justify-center h-4 min-w-4 px-1 text-[10px] font-medium bg-blue-100 text-blue-700 rounded-full">
            {openThreadCount}
          </span>
        )}
      </td>
      <td className="px-4 py-2.5 text-xs text-muted-foreground">
        {field.dataType || "--"}
      </td>
      <td className="px-4 py-2.5 text-xs">
        {field.isRequired ? (
          <span className="text-red-500 font-medium">*</span>
        ) : (
          <span className="text-muted-foreground">--</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        <MappingStatusBadge status={status} />
      </td>
      <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono truncate max-w-xs">
        {sourcePreview || "--"}
      </td>
    </tr>
  );
}
