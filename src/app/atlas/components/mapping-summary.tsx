"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  MAPPING_STATUS_COLORS,
  MAPPING_STATUS_LABELS,
  MAPPING_TYPE_LABELS,
  MAPPING_TYPE_DESCRIPTIONS,
  CONFIDENCE_COLORS,
  type MappingStatus,
  type MappingType,
  type ConfidenceLevel,
} from "@/lib/constants";
import type { MappingWithContext } from "@/types/mapping";
import { ArrowRight } from "lucide-react";

export function MappingSummary({ mapping }: { mapping: MappingWithContext }) {
  const status = mapping.status as MappingStatus;
  const mappingType = mapping.mappingType as MappingType | null;
  const confidence = mapping.confidence as ConfidenceLevel | null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Mapping Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Source → Target */}
        <div className="flex items-center gap-2 text-sm">
          <div className="font-mono text-xs bg-muted px-2 py-1 rounded">
            {mapping.sourceField
              ? `${mapping.sourceField.entityName}.${mapping.sourceField.name}`
              : "—"}
          </div>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <div className="font-mono text-xs bg-muted px-2 py-1 rounded">
            {mapping.targetField.entityName}.{mapping.targetField.name}
          </div>
        </div>

        {/* Badges row */}
        <div className="flex flex-wrap gap-2">
          {/* Status */}
          <Badge
            className="text-white border-0 text-[10px]"
            style={{ backgroundColor: MAPPING_STATUS_COLORS[status] }}
          >
            {MAPPING_STATUS_LABELS[status]}
          </Badge>

          {/* Mapping type */}
          {mappingType && (
            <Badge variant="secondary" className="text-[10px]" title={MAPPING_TYPE_DESCRIPTIONS[mappingType]}>
              {MAPPING_TYPE_LABELS[mappingType]}
            </Badge>
          )}

          {/* Confidence */}
          {confidence && (
            <Badge
              className="text-white border-0 text-[10px]"
              style={{ backgroundColor: CONFIDENCE_COLORS[confidence] }}
            >
              {confidence}
            </Badge>
          )}

          {/* Created by */}
          <Badge variant="outline" className="text-[10px]">
            {mapping.createdBy}
          </Badge>
        </div>

        {/* Data types */}
        {mapping.targetField.dataType && (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Data types: </span>
            {mapping.sourceField ? (
              <>source type → <code className="bg-muted px-1 rounded">{mapping.targetField.dataType}</code></>
            ) : (
              <code className="bg-muted px-1 rounded">{mapping.targetField.dataType}</code>
            )}
          </div>
        )}

        {/* Transform */}
        {mapping.transform && (
          <div>
            <div className="text-xs font-medium mb-1">Transform</div>
            <code className="block text-xs bg-muted p-2 rounded font-mono whitespace-pre-wrap">
              {mapping.transform}
            </code>
          </div>
        )}

        {/* Enum mapping */}
        {mapping.enumMapping && Object.keys(mapping.enumMapping).length > 0 && (
          <div>
            <div className="text-xs font-medium mb-1">Enum Mapping</div>
            <div className="border rounded overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted">
                    <th className="text-left px-2 py-1 font-medium">Source</th>
                    <th className="text-left px-2 py-1 font-medium">Target</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(mapping.enumMapping).map(([k, v]) => (
                    <tr key={k} className="border-t">
                      <td className="px-2 py-1 font-mono">{k}</td>
                      <td className="px-2 py-1 font-mono">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Default value */}
        {mapping.defaultValue && (
          <div className="text-xs">
            <span className="font-medium">Default: </span>
            <code className="bg-muted px-1 rounded">{mapping.defaultValue}</code>
          </div>
        )}

        {/* Assignee */}
        {mapping.assigneeId && (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Assignee: </span>
            {mapping.assigneeId}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
