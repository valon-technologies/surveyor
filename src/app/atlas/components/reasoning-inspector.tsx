"use client";

import { useMapping, useMappingContexts, useMappingHistory } from "@/queries/mapping-queries";
import { useGeneration } from "@/queries/generation-queries";
import { MappingSummary } from "./mapping-summary";
import { GenerationDetail } from "./generation-detail";
import { EvidencePanel } from "./evidence-panel";
import { ContextViewer } from "./context-viewer";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  MAPPING_STATUS_LABELS,
  MAPPING_STATUS_COLORS,
  MAPPING_TYPE_LABELS,
  type MappingStatus,
  type MappingType,
} from "@/lib/constants";
import { History, GitCommit } from "lucide-react";

export function ReasoningInspector({ mappingId }: { mappingId: string }) {
  const { data: mapping, isLoading: mappingLoading } = useMapping(mappingId);
  const { data: contexts } = useMappingContexts(mappingId);
  const { data: history } = useMappingHistory(mappingId);
  const { data: generation } = useGeneration(
    mapping?.generationId || undefined
  );

  if (mappingLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-pulse text-sm text-muted-foreground">
          Loading mapping...
        </div>
      </div>
    );
  }

  if (!mapping) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-sm text-muted-foreground">
          Mapping not found
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      {/* Mapping Summary — always shown */}
      <MappingSummary mapping={mapping} />

      {/* Generation Detail — only if LLM-generated */}
      {generation && (
        <GenerationDetail generation={generation} mapping={mapping} />
      )}

      {/* Key Evidence — cross-references reasoning against prompt context */}
      {generation && (
        <EvidencePanel mapping={mapping} generation={generation} />
      )}

      {/* Context Viewer — only if contexts exist */}
      {contexts && contexts.length > 0 && (
        <ContextViewer contexts={contexts} />
      )}

      {/* Version History */}
      {history && history.length > 1 && (
        <VersionHistory entries={history} />
      )}
    </div>
  );
}

function VersionHistory({ entries }: { entries: Array<{
  id: string;
  version: number;
  status: MappingStatus;
  mappingType: MappingType | null;
  editedBy: string | null;
  changeSummary: string | null;
  createdBy: string;
  createdAt: string;
}> }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <History className="h-4 w-4" />
          Version History
          <Badge variant="secondary" className="text-[10px] ml-1">
            {entries.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-0">
          {entries.map((entry, i) => {
            const status = entry.status as MappingStatus;
            const mappingType = entry.mappingType as MappingType | null;
            const date = new Date(entry.createdAt);
            const isLatest = i === 0;

            return (
              <div key={entry.id} className="flex gap-3">
                {/* Timeline line */}
                <div className="flex flex-col items-center">
                  <div
                    className="h-3 w-3 rounded-full border-2 shrink-0 mt-1"
                    style={{
                      borderColor: MAPPING_STATUS_COLORS[status],
                      backgroundColor: isLatest ? MAPPING_STATUS_COLORS[status] : "transparent",
                    }}
                  />
                  {i < entries.length - 1 && (
                    <div className="w-px flex-1 bg-border" />
                  )}
                </div>

                {/* Content */}
                <div className="pb-4 flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-medium">v{entry.version}</span>
                    <Badge
                      className="text-white border-0 text-[9px] px-1.5 py-0"
                      style={{ backgroundColor: MAPPING_STATUS_COLORS[status] }}
                    >
                      {MAPPING_STATUS_LABELS[status]}
                    </Badge>
                    {mappingType && (
                      <span className="text-muted-foreground">
                        {MAPPING_TYPE_LABELS[mappingType]}
                      </span>
                    )}
                  </div>
                  {entry.changeSummary && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {entry.changeSummary}
                    </p>
                  )}
                  <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                    <GitCommit className="h-3 w-3" />
                    {entry.editedBy || entry.createdBy} &middot;{" "}
                    {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
