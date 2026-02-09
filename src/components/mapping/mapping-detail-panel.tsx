"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { MappingStatusBadge } from "@/components/shared/status-badge";
import { SourceFieldPicker } from "./source-field-picker";
import { EnumMappingEditor } from "./enum-mapping-editor";
import { MappingHistory } from "./mapping-history";
import { MappingContextTab } from "./mapping-context-tab";
import { ThreadList } from "@/components/threads/thread-list";
import { useCreateMapping, useUpdateMapping, useMappingHistory, useMappingContexts } from "@/queries/mapping-queries";
import { useThreads } from "@/queries/thread-queries";
import { cn } from "@/lib/utils";
import {
  MAPPING_STATUSES,
  MAPPING_STATUS_LABELS,
  CONFIDENCE_LEVELS,
  DEFAULT_WORKSPACE_ID,
  type MappingStatus,
  type ConfidenceLevel,
} from "@/lib/constants";
import type { FieldWithMapping } from "@/types/field";

type Tab = "mapping" | "comments" | "history" | "context";

interface MappingDetailPanelProps {
  field: FieldWithMapping;
  entityId: string;
  entityName: string;
  workspaceId: string;
  onClose: () => void;
}

export function MappingDetailPanel({
  field,
  entityId,
  entityName,
  workspaceId,
  onClose,
}: MappingDetailPanelProps) {
  const createMapping = useCreateMapping();
  const updateMapping = useUpdateMapping();
  const [activeTab, setActiveTab] = useState<Tab>("mapping");

  const existing = field.mapping;

  // Fetch counts for tab labels
  const { data: history } = useMappingHistory(existing?.id);
  const { data: threads } = useThreads({
    fieldMappingId: existing?.id,
  });

  const { data: mappingContexts } = useMappingContexts(existing?.id);

  const historyCount = history?.length ?? 0;
  const threadCount = threads?.filter((t) => t.status === "open").length ?? 0;
  const contextCount = mappingContexts?.length ?? 0;

  const [status, setStatus] = useState<MappingStatus>(
    (existing?.status as MappingStatus) || "unmapped"
  );
  const [sourceEntityId, setSourceEntityId] = useState(existing?.sourceEntityId || "");
  const [sourceFieldId, setSourceFieldId] = useState(existing?.sourceFieldId || "");
  const [transform, setTransform] = useState(existing?.transform || "");
  const [defaultValue, setDefaultValue] = useState(existing?.defaultValue || "");
  const [reasoning, setReasoning] = useState("");
  const [confidence, setConfidence] = useState<ConfidenceLevel | "">(
    (existing?.confidence as ConfidenceLevel) || ""
  );
  const [notes, setNotes] = useState("");
  const [enumMapping, setEnumMapping] = useState<Record<string, string>>({});
  const [editedBy, setEditedBy] = useState("");

  // Reset form when field changes
  useEffect(() => {
    const m = field.mapping;
    setStatus((m?.status as MappingStatus) || "unmapped");
    setSourceEntityId(m?.sourceEntityId || "");
    setSourceFieldId(m?.sourceFieldId || "");
    setTransform(m?.transform || "");
    setDefaultValue(m?.defaultValue || "");
    setConfidence((m?.confidence as ConfidenceLevel) || "");
    setReasoning("");
    setNotes("");
    setEnumMapping({});
    setEditedBy("");
    setActiveTab("mapping");
  }, [field.id, field.mapping]);

  const handleSave = () => {
    if (existing?.id) {
      updateMapping.mutate({
        id: existing.id,
        status,
        sourceEntityId: sourceEntityId || null,
        sourceFieldId: sourceFieldId || null,
        transform: transform || null,
        defaultValue: defaultValue || null,
        enumMapping: Object.keys(enumMapping).length > 0 ? enumMapping : null,
        reasoning: reasoning || null,
        confidence: (confidence as ConfidenceLevel) || null,
        notes: notes || null,
        editedBy: editedBy || undefined,
      });
    } else {
      createMapping.mutate({
        targetFieldId: field.id,
        status,
        sourceEntityId: sourceEntityId || undefined,
        sourceFieldId: sourceFieldId || undefined,
        transform: transform || undefined,
        defaultValue: defaultValue || undefined,
        enumMapping: Object.keys(enumMapping).length > 0 ? enumMapping : undefined,
        reasoning: reasoning || undefined,
        confidence: (confidence as ConfidenceLevel) || undefined,
        notes: notes || undefined,
      });
    }
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "mapping", label: "Mapping" },
    {
      id: "comments",
      label: threadCount > 0 ? `Comments (${threadCount})` : "Comments",
    },
    {
      id: "history",
      label: historyCount > 1 ? `History (v${historyCount})` : "History",
    },
    {
      id: "context",
      label: contextCount > 0 ? `Context (${contextCount})` : "Context",
    },
  ];

  return (
    <div className="w-[420px] border-l bg-background overflow-y-auto shrink-0">
      <div className="p-4 border-b flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm font-mono">{field.name}</h3>
          <p className="text-xs text-muted-foreground">
            {field.dataType || "unknown"}{field.isRequired ? " (required)" : ""}
          </p>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-muted">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex-1 px-3 py-2 text-xs font-medium transition-colors border-b-2",
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "mapping" && (
        <div className="p-4 space-y-4">
          {field.description && (
            <p className="text-xs text-muted-foreground">{field.description}</p>
          )}

          {/* Status */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Status</label>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as MappingStatus)}
              options={MAPPING_STATUSES.map((s) => ({
                value: s,
                label: MAPPING_STATUS_LABELS[s],
              }))}
            />
          </div>

          {/* Source Field Picker */}
          {(status === "mapped" || status === "derived") && (
            <SourceFieldPicker
              sourceEntityId={sourceEntityId}
              sourceFieldId={sourceFieldId}
              onChangeEntity={setSourceEntityId}
              onChangeField={setSourceFieldId}
            />
          )}

          {/* Transform */}
          {(status === "mapped" || status === "derived") && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium">SQL Transform</label>
              <Textarea
                value={transform}
                onChange={(e) => setTransform(e.target.value)}
                placeholder="e.g. CAST(source_field AS DATE)"
                className="font-mono text-xs"
                rows={2}
              />
            </div>
          )}

          {/* Default Value */}
          {(status === "default" || status === "system_generated") && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Default Value</label>
              <Input
                value={defaultValue}
                onChange={(e) => setDefaultValue(e.target.value)}
                placeholder="Enter default value"
              />
            </div>
          )}

          {/* Enum Mapping */}
          {field.enumValues && field.enumValues.length > 0 && (
            <EnumMappingEditor
              enumValues={field.enumValues}
              mapping={enumMapping}
              onChange={setEnumMapping}
            />
          )}

          {/* Confidence */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Confidence</label>
            <Select
              value={confidence}
              onChange={(e) => setConfidence(e.target.value as ConfidenceLevel | "")}
              options={[
                { value: "", label: "Not set" },
                ...CONFIDENCE_LEVELS.map((c) => ({
                  value: c,
                  label: c.charAt(0).toUpperCase() + c.slice(1),
                })),
              ]}
            />
          </div>

          {/* Reasoning */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Reasoning</label>
            <Textarea
              value={reasoning}
              onChange={(e) => setReasoning(e.target.value)}
              placeholder="Why this mapping decision?"
              rows={2}
            />
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Notes</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes..."
              rows={2}
            />
          </div>

          {/* Edited By */}
          {existing?.id && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Your Name</label>
              <Input
                value={editedBy}
                onChange={(e) => setEditedBy(e.target.value)}
                placeholder="Who is making this change?"
              />
            </div>
          )}

          {/* Save */}
          <div className="flex gap-2 pt-2">
            <Button
              onClick={handleSave}
              disabled={createMapping.isPending || updateMapping.isPending}
              className="flex-1"
            >
              {createMapping.isPending || updateMapping.isPending
                ? "Saving..."
                : existing?.id
                  ? "Update Mapping"
                  : "Save Mapping"}
            </Button>
          </div>

          {existing?.createdBy && (
            <p className="text-xs text-muted-foreground text-center">
              Created by: {existing.createdBy}
            </p>
          )}
        </div>
      )}

      {activeTab === "comments" && (
        <ThreadList
          entityId={entityId}
          fieldMappingId={existing?.id}
          workspaceId={workspaceId}
        />
      )}

      {activeTab === "history" && (
        <MappingHistory mappingId={existing?.id} />
      )}

      {activeTab === "context" && (
        <MappingContextTab
          mappingId={existing?.id}
          entityName={entityName}
          fieldName={field.name}
          dataType={field.dataType || null}
        />
      )}
    </div>
  );
}
