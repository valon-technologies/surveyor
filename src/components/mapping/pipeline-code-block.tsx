"use client";

import { useState, useMemo } from "react";
import { ChevronDown, ChevronRight, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SqlCodeBlock } from "./sql-code-block";
import { renderPipelineSql } from "@/lib/pipeline/sql-renderer";
import type { EntityPipelineWithColumns } from "@/types/pipeline";

type CodeView = "yaml" | "sql";

interface PipelineCodeBlockProps {
  yaml: string;
  pipeline: EntityPipelineWithColumns;
}

export function PipelineCodeBlock({ yaml, pipeline }: PipelineCodeBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const [codeView, setCodeView] = useState<CodeView>("yaml");
  const [copied, setCopied] = useState(false);

  // Lazy compute SQL only when toggled
  const sql = useMemo(() => {
    if (codeView === "sql") return renderPipelineSql(pipeline);
    return "";
  }, [codeView, pipeline]);

  const handleCopy = async () => {
    const content = codeView === "yaml" ? yaml : sql;
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="px-4 py-3 border-t">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Code
        </button>

        {expanded && (
          <div className="flex items-center gap-1 rounded-lg border bg-muted/50 p-0.5">
            {(["yaml", "sql"] as const).map((view) => (
              <button
                key={view}
                onClick={() => setCodeView(view)}
                className={cn(
                  "px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-md transition-colors",
                  codeView === view
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {view}
              </button>
            ))}
          </div>
        )}
      </div>

      {expanded && (
        <div className="mt-2 relative">
          <Button
            size="sm"
            variant="ghost"
            onClick={handleCopy}
            className="absolute top-2 right-2 h-6 w-6 p-0 z-10"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          </Button>

          {codeView === "yaml" ? (
            <pre className="rounded-lg border bg-muted/30 p-4 overflow-x-auto text-xs font-mono leading-relaxed max-h-[500px] overflow-y-auto">
              {highlightYaml(yaml)}
            </pre>
          ) : (
            <SqlCodeBlock sql={sql} />
          )}
        </div>
      )}
    </div>
  );
}

// Inline YAML highlighting — same as YamlCodeBlock to avoid extra import
function highlightYaml(text: string): React.ReactNode[] {
  return text.split("\n").map((line, i) => {
    if (line.trimStart().startsWith("#")) {
      return (
        <span key={i}>
          <span className="text-gray-400 dark:text-gray-500">{line}</span>
          {"\n"}
        </span>
      );
    }

    const keyMatch = line.match(/^(\s*)([\w_-]+)(\s*:\s*)(.*)/);
    if (keyMatch) {
      const [, indent, key, colon, value] = keyMatch;
      return (
        <span key={i}>
          {indent}
          <span className="text-sky-600 dark:text-sky-400">{key}</span>
          <span className="text-muted-foreground">{colon}</span>
          {highlightValue(value)}
          {"\n"}
        </span>
      );
    }

    const listMatch = line.match(/^(\s*)(- )(.*)/);
    if (listMatch) {
      const [, indent, dash, rest] = listMatch;
      const innerKey = rest.match(/^([\w_-]+)(\s*:\s*)(.*)/);
      if (innerKey) {
        return (
          <span key={i}>
            {indent}
            <span className="text-muted-foreground">{dash}</span>
            <span className="text-sky-600 dark:text-sky-400">{innerKey[1]}</span>
            <span className="text-muted-foreground">{innerKey[2]}</span>
            {highlightValue(innerKey[3])}
            {"\n"}
          </span>
        );
      }
      return (
        <span key={i}>
          {indent}
          <span className="text-muted-foreground">{dash}</span>
          {highlightValue(rest)}
          {"\n"}
        </span>
      );
    }

    return <span key={i}>{line}{"\n"}</span>;
  });
}

function highlightValue(value: string): React.ReactNode {
  if (!value) return null;
  if (value.startsWith('"') || value.startsWith("'")) {
    return <span className="text-emerald-600 dark:text-emerald-400">{value}</span>;
  }
  if (/^\d+(\.\d+)?$/.test(value.trim())) {
    return <span className="text-amber-600 dark:text-amber-400">{value}</span>;
  }
  if (/^(true|false|null|~)$/i.test(value.trim())) {
    return <span className="text-violet-600 dark:text-violet-400">{value}</span>;
  }
  return <span>{value}</span>;
}
