"use client";

import { useState, useMemo, useCallback } from "react";
import { Copy, Check, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { generateCode, type MappingCodeInput } from "@/lib/codegen/mapping-codegen";
import type { FieldWithMapping } from "@/types/field";
import Link from "next/link";

function fieldToCodeInput(
  field: FieldWithMapping,
  entityName: string
): MappingCodeInput | null {
  const m = field.mapping;
  if (!m || m.status === "unmapped") return null;

  return {
    targetEntityName: entityName,
    targetFieldName: field.displayName || field.name,
    targetDataType: field.dataType,
    sourceEntityName: m.sourceEntityName ?? null,
    sourceFieldName: m.sourceFieldName ?? null,
    mappingType: m.mappingType,
    transform: m.transform,
    defaultValue: m.defaultValue,
    enumMapping: null, // not available on FieldWithMapping
  };
}

export function FieldInlineCode({
  field,
  entityId,
  entityName,
}: {
  field: FieldWithMapping;
  entityId: string;
  entityName: string;
}) {
  const [codeFormat, setCodeFormat] = useState<"sql" | "json" | "yaml">("sql");
  const [copied, setCopied] = useState(false);

  const codeInput = useMemo(
    () => fieldToCodeInput(field, entityName),
    [field, entityName]
  );

  const code = useMemo(
    () => (codeInput ? generateCode(codeInput, codeFormat) : null),
    [codeInput, codeFormat]
  );

  const handleCopy = useCallback(() => {
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [code]);

  if (!codeInput) {
    return (
      <div className="mx-2 mb-1.5 px-3 py-2 bg-muted/50 rounded-md">
        <p className="text-[10px] text-muted-foreground italic">
          No mapping defined
        </p>
      </div>
    );
  }

  return (
    <div className="mx-2 mb-1.5 bg-muted/50 rounded-md overflow-hidden">
      {/* Tab bar + actions */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-border/50">
        <div className="flex gap-0.5">
          {(["sql", "json", "yaml"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setCodeFormat(f)}
              className={cn(
                "text-[9px] px-1.5 py-0.5 rounded transition-colors uppercase font-medium",
                codeFormat === f
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleCopy}
            className="p-0.5 rounded hover:bg-muted-foreground/10 text-muted-foreground"
            title="Copy code"
          >
            {copied ? (
              <Check className="h-3 w-3 text-green-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </button>
          <Link
            href={`/mapping?entityId=${entityId}`}
            className="p-0.5 rounded hover:bg-muted-foreground/10 text-muted-foreground"
            title="Open in mapping review"
          >
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </div>

      {/* Code block */}
      <pre className="overflow-auto max-h-[150px] p-2">
        <code className="font-mono text-[10px] leading-relaxed whitespace-pre">
          {code}
        </code>
      </pre>
    </div>
  );
}
