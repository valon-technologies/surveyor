"use client";

import { useMemo } from "react";
import { useTopologyStore } from "@/stores/topology-store";
import { Button } from "@/components/ui/button";
import { PanelRightClose } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MappingWithContext } from "@/types/mapping";

function generateSQL(mapping: MappingWithContext): string {
  const target = `${mapping.targetField.entityName}.${mapping.targetField.name}`;
  const mappingType = mapping.mappingType || "unmapped";
  const lines: string[] = [];

  lines.push(`-- Target: ${target}`);
  lines.push(`-- Mapping type: ${mappingType}`);

  const hasSource = !!mapping.sourceField;
  const hasDefault = !!mapping.defaultValue;
  const hasEnum = mapping.enumMapping && Object.keys(mapping.enumMapping).length > 0;

  if (mapping.transform) {
    // Wrap raw transform in a runnable SELECT ... FROM
    lines.push("");
    if (hasSource) {
      lines.push("SELECT");
      lines.push(`  ${mapping.transform}`);
      lines.push(`FROM ${mapping.sourceField!.entityName}`);
    } else {
      lines.push("SELECT");
      lines.push(`  ${mapping.transform}`);
    }
  } else if (hasSource) {
    const source = `${mapping.sourceField!.entityName}.${mapping.sourceField!.name}`;
    lines.push("");
    lines.push("SELECT");

    // Build the column expression
    let expr: string;

    if (hasEnum) {
      // Inline CASE WHEN for enum mappings
      const entries = Object.entries(mapping.enumMapping!);
      expr = `  CASE`;
      for (const [src, tgt] of entries) {
        expr += `\n    WHEN ${source} = '${src}' THEN '${tgt}'`;
      }
      if (hasDefault) {
        expr += `\n    ELSE '${mapping.defaultValue}'`;
      }
      expr += `\n  END`;
    } else if (mappingType === "type_cast" && mapping.targetField.dataType) {
      expr = hasDefault
        ? `  CAST(COALESCE(${source}, '${mapping.defaultValue}') AS ${mapping.targetField.dataType})`
        : `  CAST(${source} AS ${mapping.targetField.dataType})`;
    } else if (hasDefault) {
      expr = `  COALESCE(${source}, '${mapping.defaultValue}')`;
    } else {
      expr = `  ${source}`;
    }

    lines.push(expr);
    lines.push(`FROM ${mapping.sourceField!.entityName}`);
  } else if (hasDefault) {
    lines.push("");
    lines.push("SELECT");
    lines.push(`  '${mapping.defaultValue}'`);
  } else {
    lines.push("");
    lines.push("-- No source mapping defined");
  }

  return lines.join("\n");
}

function generateJSON(mapping: MappingWithContext): string {
  const obj: Record<string, unknown> = {
    target: {
      entity: mapping.targetField.entityName,
      field: mapping.targetField.name,
      dataType: mapping.targetField.dataType,
    },
    source: mapping.sourceField
      ? {
          entity: mapping.sourceField.entityName,
          field: mapping.sourceField.name,
        }
      : null,
    mappingType: mapping.mappingType,
    transform: mapping.transform,
    defaultValue: mapping.defaultValue,
  };

  if (mapping.enumMapping && Object.keys(mapping.enumMapping).length > 0) {
    obj.enumMapping = mapping.enumMapping;
  }

  return JSON.stringify(obj, null, 2);
}

function generateYAML(mapping: MappingWithContext): string {
  const lines: string[] = [];

  lines.push("target:");
  lines.push(`  entity: ${mapping.targetField.entityName}`);
  lines.push(`  field: ${mapping.targetField.name}`);
  lines.push(
    `  dataType: ${mapping.targetField.dataType || "null"}`
  );

  lines.push("source:");
  if (mapping.sourceField) {
    lines.push(`  entity: ${mapping.sourceField.entityName}`);
    lines.push(`  field: ${mapping.sourceField.name}`);
  } else {
    lines.push("  null");
  }

  lines.push(`mappingType: ${mapping.mappingType || "null"}`);

  if (mapping.transform) {
    lines.push("transform: |");
    mapping.transform.split("\n").forEach((l) => {
      lines.push(`  ${l}`);
    });
  } else {
    lines.push("transform: null");
  }

  lines.push(
    `defaultValue: ${mapping.defaultValue ? `"${mapping.defaultValue}"` : "null"}`
  );

  if (mapping.enumMapping && Object.keys(mapping.enumMapping).length > 0) {
    lines.push("enumMapping:");
    for (const [src, tgt] of Object.entries(mapping.enumMapping)) {
      lines.push(`  "${src}": "${tgt}"`);
    }
  }

  return lines.join("\n");
}

export function CodePanel({ mapping }: { mapping: MappingWithContext }) {
  const { codeFormat, setCodeFormat, toggleRightPanel } = useTopologyStore();

  const code = useMemo(() => {
    switch (codeFormat) {
      case "sql":
        return generateSQL(mapping);
      case "json":
        return generateJSON(mapping);
      case "yaml":
        return generateYAML(mapping);
    }
  }, [mapping, codeFormat]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b flex items-center justify-between">
        <div className="flex gap-1">
          {(["sql", "json", "yaml"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setCodeFormat(f)}
              className={cn(
                "text-[10px] px-2 py-1 rounded-md transition-colors uppercase font-medium",
                codeFormat === f
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              )}
            >
              {f}
            </button>
          ))}
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
