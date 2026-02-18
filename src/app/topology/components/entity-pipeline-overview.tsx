"use client";

import { useEntityPipeline } from "@/queries/pipeline-queries";
import { useEntities } from "@/queries/entity-queries";
import { useTopologyStore } from "@/stores/topology-store";
import { Badge } from "@/components/ui/badge";
import { Loader2, Database, Link2, Columns3, Download, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useExportPipelineYaml } from "@/queries/pipeline-queries";
import { cn } from "@/lib/utils";
import type {
  PipelineSource,
  PipelineJoin,
  PipelineColumn,
} from "@/types/pipeline";

interface Props {
  entityId: string;
  entityName: string;
}

export function EntityPipelineOverview({ entityId, entityName }: Props) {
  const { data: pipeline, isLoading, error } = useEntityPipeline(entityId);
  const { exportYaml } = useExportPipelineYaml(entityId);
  const { data: allEntities } = useEntities({ side: "target" });
  const { selectEntity } = useTopologyStore();

  // Find child entities of this assembly
  const childEntities = allEntities?.filter((e) => e.parentEntityId === entityId) || [];
  const childByName = new Map(childEntities.map((c) => [c.name, c]));

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading pipeline...
        </div>
      </div>
    );
  }

  if (error || !pipeline) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <div className="text-center space-y-2">
          <p className="text-sm text-muted-foreground">
            No pipeline generated yet
          </p>
          <p className="text-xs text-muted-foreground/60">
            Run a batch generation on this entity to create a pipeline
          </p>
        </div>
      </div>
    );
  }

  const sources = pipeline.sources || [];
  const joins = pipeline.joins || [];
  const columns = pipeline.columns || [];

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{entityName}</h2>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="secondary">{pipeline.structureType}</Badge>
            <span className="text-xs text-muted-foreground">
              v{pipeline.version}
            </span>
            {pipeline.isStale && (
              <Badge variant="destructive" className="text-[10px]">
                stale
              </Badge>
            )}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={exportYaml}>
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Export YAML
        </Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard
          icon={Database}
          label="Sources"
          value={sources.length}
        />
        <StatCard
          icon={Link2}
          label="Joins"
          value={joins.length}
        />
        <StatCard
          icon={Columns3}
          label="Columns"
          value={columns.length}
        />
      </div>

      {/* Sources */}
      {sources.length > 0 && (
        <section>
          <h3 className="text-sm font-medium mb-2">Sources</h3>
          <div className="space-y-1.5">
            {sources.map((s) => {
              // Check if this source matches a child component entity
              const matchedChild = childByName.get(s.alias) || childByName.get(s.name);
              return (
                <SourceRow
                  key={s.alias}
                  source={s}
                  childEntityId={matchedChild?.id}
                  onNavigate={matchedChild ? () => selectEntity(matchedChild.id) : undefined}
                />
              );
            })}
          </div>
        </section>
      )}

      {/* Joins */}
      {joins.length > 0 && (
        <section>
          <h3 className="text-sm font-medium mb-2">Joins</h3>
          <div className="space-y-1.5">
            {joins.map((j, i) => (
              <JoinRow key={i} join={j} />
            ))}
          </div>
        </section>
      )}

      {/* Columns */}
      {columns.length > 0 && (
        <section>
          <h3 className="text-sm font-medium mb-2">Columns</h3>
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="text-left px-3 py-2 font-medium">
                    Target Column
                  </th>
                  <th className="text-left px-3 py-2 font-medium">Source</th>
                  <th className="text-left px-3 py-2 font-medium">
                    Transform
                  </th>
                  <th className="text-left px-3 py-2 font-medium">Type</th>
                </tr>
              </thead>
              <tbody>
                {columns.map((col) => (
                  <ColumnRow key={col.target_column} column={col} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-lg border px-4 py-3">
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-xs">{label}</span>
      </div>
      <span className="text-xl font-semibold">{value}</span>
    </div>
  );
}

function SourceRow({
  source,
  childEntityId,
  onNavigate,
}: {
  source: PipelineSource;
  childEntityId?: string;
  onNavigate?: () => void;
}) {
  const isClickable = !!onNavigate;
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border px-3 py-2 text-xs",
        isClickable && "cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
      )}
      onClick={onNavigate}
      role={isClickable ? "button" : undefined}
    >
      <Database className="h-3.5 w-3.5 text-blue-500 shrink-0" />
      <span className="font-mono font-medium">{source.alias}</span>
      <span className="text-muted-foreground truncate">{source.table}</span>
      {source.filters && source.filters.length > 0 && (
        <Badge variant="secondary" className="text-[9px] ml-auto">
          {source.filters.length} filter{source.filters.length !== 1 ? "s" : ""}
        </Badge>
      )}
      {isClickable && (
        <ArrowRight className="h-3.5 w-3.5 text-primary shrink-0 ml-auto" />
      )}
    </div>
  );
}

function joinSideLabel(side: unknown): string {
  if (typeof side === "string") return side;
  if (side && typeof side === "object" && "source" in side) return String((side as Record<string, unknown>).source);
  return JSON.stringify(side);
}

function JoinRow({ join }: { join: PipelineJoin }) {
  return (
    <div className="rounded-md border px-3 py-2 text-xs space-y-1">
      <div className="flex items-center gap-2">
        <Link2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
        <span className="font-mono">{joinSideLabel(join.left)}</span>
        <Badge variant="outline" className="text-[9px]">
          {join.how}
        </Badge>
        <span className="font-mono">{joinSideLabel(join.right)}</span>
      </div>
      {join.on.length > 0 && (
        <div className="ml-5.5 text-muted-foreground font-mono">
          {join.on.map((o) => typeof o === "string" ? o : JSON.stringify(o)).join(", ")}
        </div>
      )}
    </div>
  );
}

const TRANSFORM_COLORS: Record<string, string> = {
  identity: "text-green-950 bg-green-100 dark:text-green-200 dark:bg-green-900/40",
  expression: "text-blue-950 bg-blue-100 dark:text-blue-200 dark:bg-blue-900/40",
  literal: "text-purple-950 bg-purple-100 dark:text-purple-200 dark:bg-purple-900/40",
  null: "text-gray-700 bg-gray-100 dark:text-gray-300 dark:bg-gray-800/40",
  hash_id: "text-amber-950 bg-amber-100 dark:text-amber-200 dark:bg-amber-900/40",
};

function ColumnRow({ column }: { column: PipelineColumn }) {
  const sourceStr =
    typeof column.source === "string"
      ? column.source
      : column.source
        ? JSON.stringify(column.source)
        : "";
  const transform = column.transform || "null";

  return (
    <tr className="border-b last:border-0 hover:bg-muted/30">
      <td className="px-3 py-1.5 font-mono font-medium">
        {column.target_column}
      </td>
      <td className="px-3 py-1.5 font-mono text-muted-foreground truncate max-w-[200px]">
        {column.expression ? (
          <span title={column.expression}>expr</span>
        ) : (
          sourceStr
        )}
      </td>
      <td className="px-3 py-1.5">
        <span
          className={cn(
            "text-[10px] px-1.5 py-0.5 rounded",
            TRANSFORM_COLORS[transform] || TRANSFORM_COLORS["null"]
          )}
        >
          {transform}
        </span>
      </td>
      <td className="px-3 py-1.5 text-muted-foreground">
        {column.dtype || "-"}
      </td>
    </tr>
  );
}
