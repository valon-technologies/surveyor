"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";

export interface EntityFieldNodeData {
  entityName: string;
  fields: Array<{
    id: string;
    name: string;
    dataType?: string | null;
    isHighlighted: boolean;
  }>;
  side: "source" | "target";
  [key: string]: unknown;
}

function EntityFieldNodeComponent({
  data,
}: NodeProps & { data: EntityFieldNodeData }) {
  const { entityName, fields, side } = data;
  const isSource = side === "source";

  return (
    <div className="bg-background border rounded-lg shadow-sm min-w-[200px] max-w-[280px]">
      {/* Entity header */}
      <div
        className={cn(
          "px-3 py-2 rounded-t-lg border-b text-xs font-semibold",
          isSource
            ? "bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200"
            : "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200"
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate">{entityName}</span>
          <span className="text-[9px] font-normal opacity-60 uppercase shrink-0">
            {side}
          </span>
        </div>
      </div>

      {/* Field rows */}
      <div className="py-1">
        {fields.map((field, idx) => (
          <div
            key={field.id}
            className={cn(
              "relative flex items-center gap-2 px-3 py-1 text-[11px]",
              field.isHighlighted && "bg-primary/10 font-medium"
            )}
          >
            {isSource && (
              <Handle
                type="source"
                position={Position.Right}
                id={`${field.id}`}
                className="!w-2 !h-2 !bg-blue-400 !border-blue-500"
                style={{ top: "50%", right: -4 }}
              />
            )}
            {!isSource && (
              <Handle
                type="target"
                position={Position.Left}
                id={`${field.id}`}
                className="!w-2 !h-2 !bg-green-400 !border-green-500"
                style={{ top: "50%", left: -4 }}
              />
            )}
            <span className="truncate flex-1">{field.name}</span>
            {field.dataType && (
              <span className="text-[9px] text-muted-foreground shrink-0">
                {field.dataType}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export const EntityFieldNode = memo(EntityFieldNodeComponent);

// Default value node for mappings with no source
export interface DefaultNodeData {
  value: string;
  [key: string]: unknown;
}

function DefaultNodeComponent({ data }: NodeProps & { data: DefaultNodeData }) {
  return (
    <div className="bg-background border border-dashed rounded-lg shadow-sm px-4 py-3">
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2 !h-2 !bg-amber-400 !border-amber-500"
      />
      <div className="text-[10px] text-muted-foreground uppercase mb-1">
        Default
      </div>
      <div className="text-xs font-mono font-medium">{data.value}</div>
    </div>
  );
}

export const DefaultNode = memo(DefaultNodeComponent);

// Unresolved source node — mapping says there's a source but we can't resolve it
export interface UnresolvedNodeData {
  label: string;
  detail: string | null;
  [key: string]: unknown;
}

function UnresolvedNodeComponent({ data }: NodeProps & { data: UnresolvedNodeData }) {
  return (
    <div className="bg-background border border-dashed border-amber-400 rounded-lg shadow-sm px-4 py-3 min-w-[180px]">
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2 !h-2 !bg-amber-400 !border-amber-500"
      />
      <div className="text-[10px] text-amber-600 dark:text-amber-400 uppercase mb-1 font-medium">
        {data.label}
      </div>
      {data.detail && (
        <div className="text-[11px] text-muted-foreground font-mono">
          {data.detail}
        </div>
      )}
    </div>
  );
}

export const UnresolvedNode = memo(UnresolvedNodeComponent);

export const nodeTypes = {
  entityField: EntityFieldNode,
  defaultValue: DefaultNode,
  unresolved: UnresolvedNode,
};
