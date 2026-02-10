"use client";

import { cn } from "@/lib/utils";
import { FieldRow } from "./field-row";
import { MAPPING_STATUS_COLORS } from "@/lib/constants";
import type { FieldWithMapping } from "@/types/field";

interface FieldTableProps {
  fields: FieldWithMapping[];
  selectedFieldId: string | null;
  onSelectField: (id: string | null) => void;
}

export function FieldTable({ fields, selectedFieldId, onSelectField }: FieldTableProps) {
  // Group by mapping status — ordered by attention priority
  const openCommentSm = fields.filter((f) => f.mapping?.status === "open_comment_sm");
  const openCommentVt = fields.filter((f) => f.mapping?.status === "open_comment_vt");
  const unmapped = fields.filter((f) => !f.mapping || f.mapping.status === "unmapped");
  const pending = fields.filter((f) => f.mapping?.status === "pending");
  const fullyClosed = fields.filter((f) => f.mapping?.status === "fully_closed");

  const sections = [
    { label: "Open Comment (SM)", fields: openCommentSm, color: MAPPING_STATUS_COLORS.open_comment_sm },
    { label: "Open Comment (VT)", fields: openCommentVt, color: MAPPING_STATUS_COLORS.open_comment_vt },
    { label: "Unmapped", fields: unmapped, color: MAPPING_STATUS_COLORS.unmapped },
    { label: "Pending", fields: pending, color: MAPPING_STATUS_COLORS.pending },
    { label: "Fully Closed", fields: fullyClosed, color: MAPPING_STATUS_COLORS.fully_closed },
  ].filter((s) => s.fields.length > 0);

  return (
    <div className="divide-y">
      {sections.map((section) => (
        <div key={section.label}>
          <div className="px-4 py-2 bg-muted/30 flex items-center gap-2">
            <div
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: section.color }}
            />
            <span className="text-xs font-medium text-muted-foreground">
              {section.label} ({section.fields.length})
            </span>
          </div>
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs font-medium text-muted-foreground border-b">
                <th className="px-4 py-2 w-48">Field</th>
                <th className="px-4 py-2 w-24">Type</th>
                <th className="px-4 py-2 w-16">Milestone</th>
                <th className="px-4 py-2 w-12">Req</th>
                <th className="px-4 py-2 w-28">Status</th>
                <th className="px-4 py-2 w-24">Confidence</th>
                <th className="px-4 py-2">Source Mapping</th>
              </tr>
            </thead>
            <tbody>
              {section.fields.map((f) => (
                <FieldRow
                  key={f.id}
                  field={f}
                  isSelected={f.id === selectedFieldId}
                  onClick={() =>
                    onSelectField(f.id === selectedFieldId ? null : f.id)
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
