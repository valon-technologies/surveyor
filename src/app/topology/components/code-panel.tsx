"use client";

import { useMemo } from "react";
import { useTopologyStore } from "@/stores/topology-store";
import { useEntityPipeline } from "@/queries/pipeline-queries";
import { Button } from "@/components/ui/button";
import { PanelRightClose, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { generateCode, type MappingCodeInput } from "@/lib/codegen/mapping-codegen";
import type { MappingWithContext } from "@/types/mapping";

function toCodeInput(mapping: MappingWithContext): MappingCodeInput {
  return {
    targetEntityName: mapping.targetField.entityName,
    targetFieldName: mapping.targetField.name,
    targetDataType: mapping.targetField.dataType,
    sourceEntityName: mapping.sourceField?.entityName ?? null,
    sourceFieldName: mapping.sourceField?.name ?? null,
    mappingType: mapping.mappingType,
    transform: mapping.transform,
    defaultValue: mapping.defaultValue,
    enumMapping: mapping.enumMapping,
  };
}

export function CodePanel({ mapping }: { mapping: MappingWithContext }) {
  const { codeFormat, setCodeFormat, toggleRightPanel } = useTopologyStore();

  const code = useMemo(
    () => generateCode(toCodeInput(mapping), codeFormat),
    [mapping, codeFormat]
  );

  return (
    <CodePanelShell
      formats={["sql", "json", "yaml"]}
      activeFormat={codeFormat}
      onFormatChange={setCodeFormat}
      code={code}
    />
  );
}

export function EntityCodePanel({ entityId }: { entityId: string }) {
  const { toggleRightPanel } = useTopologyStore();
  const { data: pipeline, isLoading } = useEntityPipeline(entityId);

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="p-3 border-b flex items-center justify-between">
          <span className="text-[10px] font-medium text-muted-foreground uppercase">
            Pipeline YAML
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleRightPanel}
            className="h-7 w-7 p-0"
            title="Collapse panel"
          >
            <PanelRightClose className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!pipeline?.yamlSpec) {
    return (
      <div className="flex flex-col h-full">
        <div className="p-3 border-b flex items-center justify-between">
          <span className="text-[10px] font-medium text-muted-foreground uppercase">
            Pipeline YAML
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleRightPanel}
            className="h-7 w-7 p-0"
            title="Collapse panel"
          >
            <PanelRightClose className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-xs text-muted-foreground text-center">
            No pipeline YAML available
          </p>
        </div>
      </div>
    );
  }

  return (
    <CodePanelShell
      formats={["yaml"]}
      activeFormat="yaml"
      onFormatChange={() => {}}
      code={pipeline.yamlSpec}
      label="Pipeline YAML"
    />
  );
}

function CodePanelShell({
  formats,
  activeFormat,
  onFormatChange,
  code,
  label,
}: {
  formats: string[];
  activeFormat: string;
  onFormatChange: (f: "sql" | "json" | "yaml") => void;
  code: string;
  label?: string;
}) {
  const { toggleRightPanel } = useTopologyStore();

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b flex items-center justify-between">
        <div className="flex gap-1">
          {label && formats.length <= 1 ? (
            <span className="text-[10px] font-medium text-muted-foreground uppercase">
              {label}
            </span>
          ) : (
            formats.map((f) => (
              <button
                key={f}
                onClick={() => onFormatChange(f as "sql" | "json" | "yaml")}
                className={cn(
                  "text-[10px] px-2 py-1 rounded-md transition-colors uppercase font-medium",
                  activeFormat === f
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                )}
              >
                {f}
              </button>
            ))
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleRightPanel}
          className="h-7 w-7 p-0"
          title="Collapse panel"
        >
          <PanelRightClose className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Code display */}
      <div className="flex-1 overflow-auto p-3">
        <pre className="bg-muted rounded-md p-3">
          <code className="font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
            {code}
          </code>
        </pre>
      </div>
    </div>
  );
}
