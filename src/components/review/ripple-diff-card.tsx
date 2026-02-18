"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, X } from "lucide-react";
import type { MappingSnapshot } from "@/types/ripple";

interface RippleDiffCardProps {
  entityName: string;
  targetFieldName: string;
  before: MappingSnapshot;
  after: MappingSnapshot;
  accepted: boolean;
  onToggle: () => void;
}

interface DiffLine {
  label: string;
  before: string | null;
  after: string | null;
}

function getDiffLines(before: MappingSnapshot, after: MappingSnapshot): DiffLine[] {
  const lines: DiffLine[] = [];

  const fields: Array<{ key: keyof MappingSnapshot; label: string }> = [
    { key: "mappingType", label: "Type" },
    { key: "sourceEntityName", label: "Source Entity" },
    { key: "sourceFieldName", label: "Source Field" },
    { key: "transform", label: "Transform" },
    { key: "defaultValue", label: "Default" },
    { key: "reasoning", label: "Reasoning" },
    { key: "confidence", label: "Confidence" },
    { key: "notes", label: "Notes" },
  ];

  for (const { key, label } of fields) {
    const bVal = before[key];
    const aVal = after[key];

    // Skip enumMapping (object) — handled separately
    if (key === "enumMapping") continue;

    const bStr = bVal != null ? String(bVal) : null;
    const aStr = aVal != null ? String(aVal) : null;

    if (bStr !== aStr) {
      lines.push({ label, before: bStr, after: aStr });
    }
  }

  // Enum mapping diff
  const bEnum = JSON.stringify(before.enumMapping);
  const aEnum = JSON.stringify(after.enumMapping);
  if (bEnum !== aEnum) {
    lines.push({
      label: "Enum Mapping",
      before: before.enumMapping ? JSON.stringify(before.enumMapping) : null,
      after: after.enumMapping ? JSON.stringify(after.enumMapping) : null,
    });
  }

  return lines;
}

export function RippleDiffCard({
  entityName,
  targetFieldName,
  before,
  after,
  accepted,
  onToggle,
}: RippleDiffCardProps) {
  const diffLines = getDiffLines(before, after);
  const hasChanges = diffLines.length > 0;

  return (
    <Card className={accepted ? "border-green-200 bg-green-50/30" : "border-muted"}>
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <code className="text-sm font-semibold">
                {entityName}.{targetFieldName}
              </code>
              {!hasChanges && (
                <Badge variant="outline" className="text-[10px]">
                  No changes
                </Badge>
              )}
            </div>

            {hasChanges && (
              <div className="mt-2 space-y-1">
                {diffLines.map((line) => (
                  <div key={line.label} className="text-xs">
                    <span className="text-muted-foreground font-medium">
                      {line.label}:
                    </span>{" "}
                    {line.before && (
                      <span className="line-through text-red-500/70 mr-1">
                        {line.before}
                      </span>
                    )}
                    {line.after && (
                      <span className="text-green-600 font-medium">
                        {line.after}
                      </span>
                    )}
                    {!line.after && !line.before && (
                      <span className="text-muted-foreground italic">
                        (removed)
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <Button
            size="sm"
            variant={accepted ? "default" : "outline"}
            className={
              accepted
                ? "bg-green-600 hover:bg-green-700 text-white h-8 w-8 p-0"
                : "h-8 w-8 p-0"
            }
            onClick={onToggle}
            disabled={!hasChanges}
          >
            {accepted ? (
              <Check className="h-4 w-4" />
            ) : (
              <X className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
