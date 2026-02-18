"use client";

import { cn } from "@/lib/utils";
import { FieldRow } from "./field-row";
import { MAPPING_STATUS_COLORS } from "@/lib/constants";
import type { FieldWithMapping } from "@/types/field";

interface FieldTableProps {
  fields: FieldWithMapping[];
  entityId: string;
  entityName: string;
  selectedFieldId: string | null;
  onSelectField: (id: string | null) => void;
  questionCountByFieldId?: Map<string, number>;
}

export function FieldTable({ fields, entityId, entityName, selectedFieldId, onSelectField, questionCountByFieldId }: FieldTableProps) {
  // Group by mapping status — ordered by attention priority
  const needsDiscussion = fields.filter((f) => f.mapping?.status === "needs_discussion");
  const punted = fields.filter((f) => f.mapping?.status === "punted");
  const unmapped = fields.filter((f) => !f.mapping || f.mapping.status === "unmapped");
  const unreviewed = fields.filter((f) => f.mapping?.status === "unreviewed");
  const accepted = fields.filter((f) => f.mapping?.status === "accepted");
  const excluded = fields.filter((f) => f.mapping?.status === "excluded");

  const sections = [
    { label: "Needs Discussion", fields: needsDiscussion, color: MAPPING_STATUS_COLORS.needs_discussion },
    { label: "Punted", fields: punted, color: MAPPING_STATUS_COLORS.punted },
    { label: "Unmapped", fields: unmapped, color: MAPPING_STATUS_COLORS.unmapped },
    { label: "Unreviewed", fields: unreviewed, color: MAPPING_STATUS_COLORS.unreviewed },
    { label: "Accepted", fields: accepted, color: MAPPING_STATUS_COLORS.accepted },
    { label: "Excluded", fields: excluded, color: MAPPING_STATUS_COLORS.excluded },
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
                  entityId={entityId}
                  entityName={entityName}
                  isSelected={f.id === selectedFieldId}
                  onClick={() =>
                    onSelectField(f.id === selectedFieldId ? null : f.id)
                  }
                  openQuestionCount={questionCountByFieldId?.get(f.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
