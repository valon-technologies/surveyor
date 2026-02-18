"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface YamlCodeBlockProps {
  yaml: string;
}

export function YamlCodeBlock({ yaml }: YamlCodeBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(yaml);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="px-4 py-3 border-t">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        YAML
      </button>
      {expanded && (
        <div className="mt-2 relative">
          <Button
            size="sm"
            variant="ghost"
            onClick={handleCopy}
            className="absolute top-2 right-2 h-6 w-6 p-0"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          </Button>
          <pre className="rounded-lg border bg-muted/30 p-4 overflow-x-auto text-xs font-mono leading-relaxed max-h-[500px] overflow-y-auto">
            {highlightYaml(yaml)}
          </pre>
        </div>
      )}
    </div>
  );
}

/** Lightweight YAML syntax highlighting using spans */
function highlightYaml(text: string): React.ReactNode[] {
  return text.split("\n").map((line, i) => {
    // Comment lines
    if (line.trimStart().startsWith("#")) {
      return (
        <span key={i}>
          <span className="text-gray-400 dark:text-gray-500">{line}</span>
          {"\n"}
        </span>
      );
    }

    // Key: value lines
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

    // List items
    const listMatch = line.match(/^(\s*)(- )(.*)/);
    if (listMatch) {
      const [, indent, dash, rest] = listMatch;
      // Check if the rest contains a key
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
  // Quoted strings
  if (value.startsWith('"') || value.startsWith("'")) {
    return <span className="text-emerald-600 dark:text-emerald-400">{value}</span>;
  }
  // Numbers
  if (/^\d+(\.\d+)?$/.test(value.trim())) {
    return <span className="text-amber-600 dark:text-amber-400">{value}</span>;
  }
  // Booleans / null
  if (/^(true|false|null|~)$/i.test(value.trim())) {
    return <span className="text-violet-600 dark:text-violet-400">{value}</span>;
  }
  return <span>{value}</span>;
}
