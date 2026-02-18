"use client";

import { useEntityPipeline, useExportPipelineYaml } from "@/queries/pipeline-queries";
import { PipelineHeader } from "./pipeline-header";
import { SourceCards } from "./source-cards";
import { JoinSummary } from "./join-summary";
import { PipelineColumnTable } from "./pipeline-column-table";
import { PipelineCodeBlock } from "./pipeline-code-block";
import { useMappingStore } from "@/stores/mapping-store";
import type { PipelineConcat } from "@/types/pipeline";
import type { FieldWithMapping } from "@/types/field";

interface PipelineViewProps {
  entityId: string;
  fields?: FieldWithMapping[];
}

export function PipelineView({ entityId, fields }: PipelineViewProps) {
  const { data: pipeline, isLoading, error } = useEntityPipeline(entityId);
  const { exportYaml } = useExportPipelineYaml(entityId);
  const { setSelectedFieldId, setActiveView } = useMappingStore();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-pulse text-sm text-muted-foreground">Loading pipeline...</div>
      </div>
    );
  }

  if (error || !pipeline) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">No pipeline generated yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Run Auto-Map with YAML output format to generate a pipeline
          </p>
        </div>
      </div>
    );
  }

  const handleColumnClick = (targetColumn: string) => {
    // Resolve column name to field ID
    const matchedField = fields?.find(
      (f) => f.name.toLowerCase() === targetColumn.toLowerCase()
    );
    if (matchedField) {
      setSelectedFieldId(matchedField.id);
      setActiveView("fields");
    }
  };

  return (
    <div className="divide-y">
      <PipelineHeader pipeline={pipeline} onExport={exportYaml} />
      <SourceCards sources={pipeline.sources} />

      {/* Assembly banner */}
      {pipeline.structureType === "assembly" && pipeline.concat && (
        <AssemblyBanner concat={pipeline.concat} />
      )}

      {/* Joins */}
      {pipeline.joins && pipeline.joins.length > 0 && (
        <JoinSummary joins={pipeline.joins} sources={pipeline.sources} />
      )}

      {/* Columns table */}
      <PipelineColumnTable
        columns={pipeline.columns}
        sources={pipeline.sources}
        onColumnClick={handleColumnClick}
      />

      {/* Collapsible YAML / SQL */}
      <PipelineCodeBlock yaml={pipeline.yamlSpec} pipeline={pipeline} />
    </div>
  );
}

function AssemblyBanner({ concat }: { concat: PipelineConcat }) {
  const sources = concat.sources ?? [];
  return (
    <div className="px-4 py-3 border-t">
      <div className="rounded-lg border-2 border-dashed border-violet-300 dark:border-violet-700 bg-violet-50/50 dark:bg-violet-950/20 px-4 py-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400 mb-1">
          Assembly: UNION ALL
        </h3>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {sources.map((alias, i) => (
            <span key={alias}>
              {i > 0 && <span className="mx-1">+</span>}
              <span className="font-medium text-violet-700 dark:text-violet-300">[{alias}]</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
