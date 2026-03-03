"use client";

import { useSotMappingStore } from "@/stores/sot-mapping-store";
import { cn } from "@/lib/utils";
import type { SotColumn } from "@/lib/sot/yaml-parser";

interface SotFieldTableProps {
  columns: SotColumn[];
}

const transformBadge: Record<
  string,
  { label: string; className: string }
> = {
  identity: {
    label: "identity",
    className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  },
  expression: {
    label: "expression",
    className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  },
  hash_id: {
    label: "hash_id",
    className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  },
  null: {
    label: "null",
    className: "bg-muted text-muted-foreground",
  },
};

export function SotFieldTable({ columns }: SotFieldTableProps) {
  const { expandedFields, toggleFieldExpanded } = useSotMappingStore();

  return (
    <div className="border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50 border-b">
            <th className="text-left px-3 py-2 font-medium">Target Column</th>
            <th className="text-left px-3 py-2 font-medium">Sources</th>
            <th className="text-left px-3 py-2 font-medium w-28">Transform</th>
            <th className="text-left px-3 py-2 font-medium w-20">dtype</th>
          </tr>
        </thead>
        <tbody>
          {columns.map((col) => {
            const isExpanded = expandedFields.has(col.targetColumn);
            const badge =
              transformBadge[col.transform || "null"] || transformBadge.null;
            const hasExpandableContent =
              (col.transform === "expression" && col.expression) ||
              (col.transform === "hash_id" && col.hashColumns);

            return (
              <FieldRow
                key={col.targetColumn}
                col={col}
                badge={badge}
                isExpanded={isExpanded}
                hasExpandableContent={!!hasExpandableContent}
                onToggle={() => toggleFieldExpanded(col.targetColumn)}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FieldRow({
  col,
  badge,
  isExpanded,
  hasExpandableContent,
  onToggle,
}: {
  col: SotColumn;
  badge: { label: string; className: string };
  isExpanded: boolean;
  hasExpandableContent: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={hasExpandableContent ? onToggle : undefined}
        className={cn(
          "border-b last:border-0",
          hasExpandableContent
            ? "cursor-pointer hover:bg-muted/30"
            : "hover:bg-muted/30"
        )}
      >
        <td className="px-3 py-1.5 font-mono text-xs">{col.targetColumn}</td>
        <td className="px-3 py-1.5">
          <SourcesCell sources={col.resolvedSources} />
        </td>
        <td className="px-3 py-1.5">
          <span
            className={cn(
              "text-[10px] px-1.5 py-0.5 rounded font-medium",
              badge.className
            )}
          >
            {badge.label}
          </span>
        </td>
        <td className="px-3 py-1.5 text-xs text-muted-foreground">
          {col.dtype || "\u2014"}
        </td>
      </tr>
      {isExpanded && (
        <tr className="border-b last:border-0">
          <td colSpan={4} className="px-3 py-2">
            {col.transform === "expression" && col.expression && (
              <pre className="text-xs font-mono bg-muted/50 rounded p-2 mt-1 overflow-x-auto whitespace-pre-wrap">
                {col.expression.trim()}
              </pre>
            )}
            {col.transform === "hash_id" && col.hashColumns && (
              <div className="text-xs mt-1">
                <span className="text-muted-foreground font-medium">
                  Hash columns:{" "}
                </span>
                <span className="font-mono">
                  {col.hashColumns.join(", ")}
                </span>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function SourcesCell({ sources }: { sources: string[] }) {
  if (sources.length === 0) {
    return <span className="text-xs text-muted-foreground">&mdash;</span>;
  }

  return (
    <div className="flex flex-wrap gap-x-2 gap-y-0.5">
      {sources.map((src, i) => {
        // Staging tables are typically lowercase (e.g., loan.loan_id)
        const isStaging = /^[a-z]/.test(src);
        return (
          <span
            key={`${src}-${i}`}
            className={cn(
              "font-mono text-xs",
              isStaging
                ? "italic text-muted-foreground"
                : "text-foreground/80"
            )}
          >
            {src}
          </span>
        );
      })}
    </div>
  );
}
