"use client";

import { cn } from "@/lib/utils";
import { FieldRow } from "./field-row";
import type { FieldWithMapping } from "@/types/field";

interface FieldTableProps {
  fields: FieldWithMapping[];
  selectedFieldId: string | null;
  onSelectField: (id: string | null) => void;
}

export function FieldTable({ fields, selectedFieldId, onSelectField }: FieldTableProps) {
  // Group by mapping status
  const unmapped = fields.filter((f) => !f.mapping || f.mapping.status === "unmapped");
  const needsClarification = fields.filter(
    (f) => f.mapping?.status === "requires_clarification"
  );
  const mapped = fields.filter(
    (f) =>
      f.mapping &&
      !["unmapped", "requires_clarification"].includes(f.mapping.status)
  );

  const sections = [
    { label: "Needs Clarification", fields: needsClarification, color: "#f59e0b" },
    { label: "Unmapped", fields: unmapped, color: "#6b7280" },
    { label: "Mapped", fields: mapped, color: "#22c55e" },
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
                <th className="px-4 py-2 w-12">Req</th>
                <th className="px-4 py-2 w-28">Status</th>
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
