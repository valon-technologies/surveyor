"use client";

import { useEntities } from "@/queries/entity-queries";
import { useEntity } from "@/queries/entity-queries";
import { Select } from "@/components/ui/select";

interface SourceFieldPickerProps {
  sourceEntityId: string;
  sourceFieldId: string;
  onChangeEntity: (id: string) => void;
  onChangeField: (id: string) => void;
}

export function SourceFieldPicker({
  sourceEntityId,
  sourceFieldId,
  onChangeEntity,
  onChangeField,
}: SourceFieldPickerProps) {
  const { data: sourceEntities } = useEntities({ side: "source" });
  const { data: sourceEntity } = useEntity(sourceEntityId || undefined);

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium">Source Field</label>
      <Select
        value={sourceEntityId}
        onChange={(e) => {
          onChangeEntity(e.target.value);
          onChangeField("");
        }}
        options={[
          { value: "", label: "Select source entity..." },
          ...(sourceEntities || []).map((e) => ({
            value: e.id,
            label: e.displayName || e.name,
          })),
        ]}
      />
      {sourceEntityId && (
        <Select
          value={sourceFieldId}
          onChange={(e) => onChangeField(e.target.value)}
          options={[
            { value: "", label: "Select field..." },
            ...(sourceEntity?.fields || []).map((f) => ({
              value: f.id,
              label: `${f.name}${f.dataType ? ` (${f.dataType})` : ""}`,
            })),
          ]}
        />
      )}
    </div>
  );
}
