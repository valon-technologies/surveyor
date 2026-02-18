"use client";

import { useState, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import { MappingStatusBadge } from "@/components/shared/status-badge";
import { MilestoneBadge } from "@/components/shared/tier-badge";
import { CONFIDENCE_COLORS, type ConfidenceLevel } from "@/lib/constants";
import { generateCode, type MappingCodeInput } from "@/lib/codegen/mapping-codegen";
import { Code2, Copy, Check, ExternalLink } from "lucide-react";
import Link from "next/link";
import type { FieldWithMapping } from "@/types/field";

interface FieldRowProps {
  field: FieldWithMapping;
  entityId: string;
  entityName: string;
  isSelected: boolean;
  onClick: () => void;
  openThreadCount?: number;
  openQuestionCount?: number;
  columnCount?: number;
}

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
    enumMapping: null,
  };
}

export function FieldRow({ field, entityId, entityName, isSelected, onClick, openThreadCount, openQuestionCount, columnCount = 7 }: FieldRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const mapping = field.mapping;
  const status = mapping?.status || "unmapped";

  let sourcePreview = "";
  if (mapping?.sourceFieldName) {
    sourcePreview = mapping.sourceEntityName
      ? `${mapping.sourceEntityName}.${mapping.sourceFieldName}`
      : mapping.sourceFieldName;
  }
  if (mapping?.transform) {
    sourcePreview = mapping.transform;
  }
  if (mapping?.defaultValue) {
    sourcePreview = `DEFAULT: ${mapping.defaultValue}`;
  }

  return (
    <>
      <tr
        onClick={onClick}
        className={cn(
          "cursor-pointer transition-colors text-sm",
          isSelected ? "bg-primary/5" : "hover:bg-muted/30",
          !isExpanded && "border-b"
        )}
      >
        <td className="px-4 py-2.5">
          <span className="font-mono text-xs">{field.name}</span>
          {field.isKey && (
            <span className="ml-1.5 text-xs text-amber-600 font-medium">PK</span>
          )}
          {field.enumValues && field.enumValues.length > 0 && (
            <span className="ml-1.5 text-[10px] text-violet-500 font-medium" title={field.enumValues.join(", ")}>
              ENUM({field.enumValues.length})
            </span>
          )}
          {openThreadCount != null && openThreadCount > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center h-4 min-w-4 px-1 text-[10px] font-medium bg-blue-100 text-blue-700 rounded-full">
              {openThreadCount}
            </span>
          )}
          {openQuestionCount != null && openQuestionCount > 0 && (
            <span
              className="ml-1.5 inline-flex items-center justify-center h-4 min-w-4 px-1 text-[10px] font-medium bg-red-100 text-red-700 rounded-full"
              title={`${openQuestionCount} open question${openQuestionCount > 1 ? "s" : ""}`}
            >
              ?{openQuestionCount > 1 ? ` ${openQuestionCount}` : ""}
            </span>
          )}
        </td>
        <td className="px-4 py-2.5 text-xs text-muted-foreground">
          {field.dataType || "--"}
        </td>
        <td className="px-4 py-2.5">
          <MilestoneBadge milestone={field.milestone} />
        </td>
        <td className="px-4 py-2.5 text-xs">
          {field.isRequired ? (
            <span className="text-red-500 font-medium">*</span>
          ) : (
            <span className="text-muted-foreground">--</span>
          )}
        </td>
        <td className="px-4 py-2.5">
          <MappingStatusBadge status={status} />
        </td>
        <td className="px-4 py-2.5">
          {mapping?.confidence ? (
            <div className="flex items-center gap-1.5">
              <div
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: CONFIDENCE_COLORS[mapping.confidence as ConfidenceLevel] }}
              />
              <span className="text-xs text-muted-foreground capitalize">
                {mapping.confidence}
              </span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">--</span>
          )}
        </td>
        <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono truncate max-w-xs">
          <div className="flex items-center gap-2">
            <span className="truncate flex-1">{sourcePreview || "--"}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(!isExpanded);
              }}
              className={cn(
                "shrink-0 p-1 rounded hover:bg-muted-foreground/10 transition-colors",
                isExpanded && "text-primary"
              )}
              title={isExpanded ? "Collapse code" : "Expand code"}
            >
              <Code2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </td>
      </tr>
      {isExpanded && (
        <tr className="border-b">
          <td colSpan={columnCount} className="px-4 pb-3 pt-1">
            <InlineCodeBlock
              field={field}
              entityId={entityId}
              entityName={entityName}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function InlineCodeBlock({
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
      <div className="px-3 py-2 bg-muted/50 rounded-md">
        <p className="text-[10px] text-muted-foreground italic">
          No mapping defined
        </p>
      </div>
    );
  }

  return (
    <div className="bg-muted/50 rounded-md overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/50">
        <div className="flex gap-1">
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
            className="p-1 rounded hover:bg-muted-foreground/10 text-muted-foreground"
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
            className="p-1 rounded hover:bg-muted-foreground/10 text-muted-foreground"
            title="Open in mapping review"
          >
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </div>
      <pre className="overflow-auto max-h-[200px] p-3">
        <code className="font-mono text-[11px] leading-relaxed whitespace-pre">
          {code}
        </code>
      </pre>
    </div>
  );
}
