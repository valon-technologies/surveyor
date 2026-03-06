"use client";

import { useQuery } from "@tanstack/react-query";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { ChevronDown, ChevronRight, History } from "lucide-react";
import { useState } from "react";

interface MappingVersion {
  id: string;
  version: number;
  status: string;
  mappingType: string | null;
  sourceEntityName?: string | null;
  sourceFieldName?: string | null;
  transform?: string | null;
  reasoning?: string | null;
  confidence?: string | null;
  sourceVerdict?: string | null;
  sourceVerdictNotes?: string | null;
  transformVerdict?: string | null;
  transformVerdictNotes?: string | null;
  notes?: string | null;
  isLatest: boolean;
  createdBy: string;
  createdAt: string;
}

interface Props {
  mappingId: string;
  transferId: string | null;
}

export function MappingHistoryPanel({ mappingId, transferId }: Props) {
  const { workspaceId } = useWorkspace();
  const [expanded, setExpanded] = useState(false);

  const { data: history } = useQuery<MappingVersion[]>({
    queryKey: ["mapping-history", mappingId],
    queryFn: async () => {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/mappings/${mappingId}/history`
      );
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!workspaceId && !!mappingId,
  });

  // Only show if there are prior versions
  const priorVersions = history?.filter((v) => !v.isLatest) || [];
  if (priorVersions.length === 0) return null;

  return (
    <div className="rounded-lg border bg-card">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 px-4 py-3 w-full text-left text-sm font-medium hover:bg-muted/50"
      >
        <History className="h-4 w-4 text-muted-foreground" />
        Prior Versions ({priorVersions.length})
        <span className="ml-auto">
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
      </button>

      {expanded && (
        <div className="border-t px-4 py-3 space-y-3 max-h-64 overflow-y-auto">
          {priorVersions.map((v) => (
            <div key={v.id} className="rounded-lg border p-3 text-sm bg-muted/30">
              <div className="flex items-center gap-2 mb-2">
                <span className="font-mono text-xs text-muted-foreground">v{v.version}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  v.status === "accepted" ? "bg-green-100 text-green-700" :
                  v.status === "unreviewed" ? "bg-blue-100 text-blue-700" :
                  v.status === "unmapped" ? "bg-gray-100 text-gray-700" :
                  "bg-gray-100 text-gray-700"
                }`}>
                  {v.status}
                </span>
                {v.confidence && (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    v.confidence === "high" ? "bg-green-100 text-green-700" :
                    v.confidence === "medium" ? "bg-amber-100 text-amber-700" :
                    "bg-red-100 text-red-700"
                  }`}>
                    {v.confidence}
                  </span>
                )}
                <span className="text-xs text-muted-foreground ml-auto">
                  {new Date(v.createdAt).toLocaleDateString()} · {v.createdBy}
                </span>
              </div>

              {/* Source mapping */}
              {v.sourceFieldName && (
                <div className="text-xs mb-1">
                  <span className="text-muted-foreground">Source:</span>{" "}
                  <span className="font-mono">{v.sourceFieldName}</span>
                  {v.transform && (
                    <span className="text-muted-foreground"> · {v.transform}</span>
                  )}
                </div>
              )}

              {/* Reasoning */}
              {v.reasoning && (
                <p className="text-xs text-muted-foreground line-clamp-2 mb-1">{v.reasoning}</p>
              )}

              {/* Verdicts from reviewers */}
              {(v.sourceVerdict || v.transformVerdict) && (
                <div className="mt-2 pt-2 border-t border-dashed space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Reviewer Feedback:</p>
                  {v.sourceVerdict && (
                    <div className="text-xs">
                      <span className={v.sourceVerdict === "correct" ? "text-green-600" : "text-amber-600"}>
                        Source: {v.sourceVerdict}
                      </span>
                      {v.sourceVerdictNotes && (
                        <p className="text-muted-foreground ml-3 line-clamp-2">{v.sourceVerdictNotes}</p>
                      )}
                    </div>
                  )}
                  {v.transformVerdict && (
                    <div className="text-xs">
                      <span className={v.transformVerdict === "correct" ? "text-green-600" : "text-amber-600"}>
                        Transform: {v.transformVerdict}
                      </span>
                      {v.transformVerdictNotes && (
                        <p className="text-muted-foreground ml-3 line-clamp-2">{v.transformVerdictNotes}</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Notes */}
              {v.notes && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{v.notes}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
