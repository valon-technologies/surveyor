"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight } from "lucide-react";

interface FieldItem {
  id: string;
  name: string;
  displayName?: string | null;
  dataType?: string | null;
  isRequired?: boolean;
  isKey?: boolean;
  description?: string | null;
  sampleValues?: string[] | null;
  enumValues?: string[] | null;
}

const ENUM_PREVIEW_LIMIT = 3;

function EnumCell({ values }: { values: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const hasMore = values.length > ENUM_PREVIEW_LIMIT;
  const displayed = expanded ? values : values.slice(0, ENUM_PREVIEW_LIMIT);

  return (
    <div className="flex flex-wrap items-center gap-1">
      {displayed.map((v) => (
        <Badge
          key={v}
          variant="secondary"
          className="text-[10px] px-1.5 py-0 font-mono"
        >
          {v}
        </Badge>
      ))}
      {hasMore && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
          className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? (
            <>
              <ChevronDown className="h-3 w-3" />
              less
            </>
          ) : (
            <>
              <ChevronRight className="h-3 w-3" />
              +{values.length - ENUM_PREVIEW_LIMIT} more
            </>
          )}
        </button>
      )}
    </div>
  );
}

export function FieldList({ fields }: { fields: FieldItem[] }) {
  const hasEnums = fields.some(
    (f) => f.enumValues && f.enumValues.length > 0
  );

  return (
    <div className="border rounded-md overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/50 text-left font-medium text-muted-foreground">
            <th className="px-3 py-2">Field</th>
            <th className="px-3 py-2 w-24">Type</th>
            <th className="px-3 py-2 w-12">Req</th>
            <th className="px-3 py-2 w-12">Key</th>
            <th className="px-3 py-2">Description</th>
            {hasEnums && <th className="px-3 py-2">Enum Values</th>}
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => (
            <tr key={f.id} className="border-t align-top">
              <td className="px-3 py-1.5 font-mono">{f.name}</td>
              <td className="px-3 py-1.5 text-muted-foreground">
                {f.dataType || "--"}
              </td>
              <td className="px-3 py-1.5">
                {f.isRequired ? (
                  <span className="text-red-500 font-medium">*</span>
                ) : null}
              </td>
              <td className="px-3 py-1.5">
                {f.isKey ? (
                  <Badge variant="outline" className="text-[10px] px-1 py-0">
                    PK
                  </Badge>
                ) : null}
              </td>
              <td className="px-3 py-1.5 text-muted-foreground truncate max-w-xs">
                {f.description || "--"}
              </td>
              {hasEnums && (
                <td className="px-3 py-1.5">
                  {f.enumValues && f.enumValues.length > 0 ? (
                    <EnumCell values={f.enumValues} />
                  ) : (
                    <span className="text-muted-foreground">--</span>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
