"use client";

import { useMappingHistory } from "@/queries/mapping-queries";
import { MappingStatusBadge } from "@/components/shared/status-badge";

interface MappingHistoryProps {
  mappingId: string | undefined;
}

export function MappingHistory({ mappingId }: MappingHistoryProps) {
  const { data: history, isLoading } = useMappingHistory(mappingId);

  if (!mappingId) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Save a mapping to see version history.
      </div>
    );
  }

  if (isLoading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading history...</div>;
  }

  if (!history || history.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">No history yet.</div>;
  }

  return (
    <div className="p-4">
      <div className="relative">
        {/* Timeline line */}
        <div className="absolute left-3 top-2 bottom-2 w-px bg-border" />

        <div className="space-y-3">
          {history.map((entry, idx) => (
            <div key={entry.id} className="relative pl-8">
              {/* Timeline dot */}
              <div
                className={`absolute left-1.5 top-2 h-3 w-3 rounded-full border-2 ${
                  idx === 0
                    ? "bg-primary border-primary"
                    : "bg-background border-muted-foreground/40"
                }`}
              />

              <div className="border rounded-lg p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">
                    v{entry.version}
                    {idx === 0 && (
                      <span className="ml-1.5 text-[10px] text-primary font-semibold">
                        CURRENT
                      </span>
                    )}
                  </span>
                  <MappingStatusBadge status={entry.status} />
                </div>

                {entry.changeSummary && (
                  <p className="text-xs text-muted-foreground">{entry.changeSummary}</p>
                )}

                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  {entry.editedBy && <span>by {entry.editedBy}</span>}
                  {!entry.editedBy && entry.createdBy && (
                    <span>via {entry.createdBy}</span>
                  )}
                  <span>{new Date(entry.createdAt).toLocaleString()}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
