"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SotSource, SotJoin } from "@/lib/sot/yaml-parser";

interface SotSourceSummaryProps {
  sources: SotSource[];
  joins: SotJoin[] | null;
}

export function SotSourceSummary({ sources, joins }: SotSourceSummaryProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Sources &amp; Joins</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Sources table */}
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="text-left px-3 py-2 font-medium">Alias</th>
                <th className="text-left px-3 py-2 font-medium">Table</th>
                <th className="text-left px-3 py-2 font-medium w-28">Type</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((src) => (
                <tr
                  key={src.alias}
                  className="border-b last:border-0 hover:bg-muted/30"
                >
                  <td className="px-3 py-1.5 font-mono text-xs font-medium">
                    {src.alias}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs">
                    {src.table}
                  </td>
                  <td className="px-3 py-1.5">
                    <span
                      className={
                        src.sourceType === "pipe_file"
                          ? "text-xs px-1.5 py-0.5 rounded font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                          : "text-xs px-1.5 py-0.5 rounded font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                      }
                    >
                      {src.sourceType === "pipe_file" ? "pipe_file" : "staging"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Joins section */}
        {joins && joins.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground mb-2">
              Joins
            </h3>
            <div className="space-y-2">
              {joins.map((join, i) => (
                <div
                  key={i}
                  className="border rounded-lg px-3 py-2 text-xs bg-muted/20"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-medium">{join.left}</span>
                    <span className="text-muted-foreground">&rarr;</span>
                    <span className="font-mono font-medium">{join.right}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                      {join.how}
                    </span>
                  </div>
                  {join.on.length > 0 && (
                    <div className="mt-1 text-muted-foreground font-mono">
                      ON {join.on.join(" AND ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
