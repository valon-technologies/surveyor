"use client";

import { useState, useEffect } from "react";
import { X, Sparkles, CheckCircle, RotateCcw, FlaskConical, XCircle, History, Globe, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { MappingStatusBadge } from "@/components/shared/status-badge";
import { SourceFieldPicker } from "./source-field-picker";
import { EnumMappingEditor } from "./enum-mapping-editor";
import { MappingActivity } from "./mapping-activity";
import { GenerateTab } from "./generate-tab";
import { ValidationTab } from "./validation-tab";
import { ThreadList } from "@/components/threads/thread-list";
import { useCreateMapping, useUpdateMapping, useFieldActivity, useCloseCase, useReopenCase, useLatestValidation } from "@/queries/mapping-queries";
import { useWorkspaceMembers } from "@/queries/member-queries";
import { useThreads } from "@/queries/thread-queries";
import { useRunGeneration } from "@/queries/generation-queries";
import { useGenerationQueueStore } from "@/stores/generation-queue-store";
import { cn } from "@/lib/utils";
import { useSession } from "next-auth/react";
import {
  MAPPING_TYPES,
  MAPPING_TYPE_LABELS,
  MAPPING_TYPE_DESCRIPTIONS,
  MILESTONES,
  MILESTONE_LABELS,
  CONFIDENCE_LEVELS,
  DEFAULT_MODELS,
  type MappingStatus,
  type MappingType,
  type ConfidenceLevel,
  type Milestone,
} from "@/lib/constants";
import { useUpdateField } from "@/queries/field-queries";
import type { FieldWithMapping } from "@/types/field";

type Tab = "mapping" | "generate" | "comments" | "validation";

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
  const { data: session } = useSession();
  const createMapping = useCreateMapping();
  const updateMapping = useUpdateMapping();
  const updateField = useUpdateField();
  const closeCase = useCloseCase();
  const reopenCase = useReopenCase();
  const { data: members } = useWorkspaceMembers();
  const [activeTab, setActiveTab] = useState<Tab>("mapping");
  const [panelView, setPanelView] = useState<"tabs" | "activity">("tabs");

  const existing = field.mapping;

  // Fetch counts for tab labels
  const { data: activities } = useFieldActivity(existing?.id);
  const { data: threads } = useThreads({
    fieldMappingId: existing?.id,
  });

  const { data: latestValidation } = useLatestValidation(existing?.id);

  const activityCount = activities?.length ?? 0;
  const threadCount = threads?.filter((t) => t.status === "open").length ?? 0;

  const [status, setStatus] = useState<MappingStatus>(
    (existing?.status as MappingStatus) || "unmapped"
  );
  const [mappingType, setMappingType] = useState<MappingType | "">(
    (existing?.mappingType as MappingType) || ""
  );
  const [assigneeId, setAssigneeId] = useState(existing?.assigneeId || "");
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
  const [reviewComment, setReviewComment] = useState<string | null>(null);
  const [autoMapBanner, setAutoMapBanner] = useState(false);
  const [autoMapProvider, setAutoMapProvider] = useState<"claude" | "openai">("claude");
  const [autoMapModel, setAutoMapModel] = useState(DEFAULT_MODELS.claude.singleField);
  const [pendingGenerationId, setPendingGenerationId] = useState<string | null>(null);
  const runGeneration = useRunGeneration();
  const addGeneration = useGenerationQueueStore((s) => s.addGeneration);
  const queue = useGenerationQueueStore((s) => s.queue);

  // Track if generation is running for this field
  const pendingItem = pendingGenerationId
    ? queue.find((g) => g.generationId === pendingGenerationId)
    : null;
  const isAutoMapping = pendingItem?.status === "running" || runGeneration.isPending;

  const handleProviderChange = (p: "claude" | "openai") => {
    setAutoMapProvider(p);
    setAutoMapModel(DEFAULT_MODELS[p].singleField);
  };

  const handleAutoMap = () => {
    setAutoMapBanner(false);
    runGeneration.mutate(
      {
        entityId,
        fieldIds: [field.id],
        generationType: "field_mapping",
        preferredProvider: autoMapProvider,
        model: autoMapModel,
      },
      {
        onSuccess: (data) => {
          setPendingGenerationId(data.generationId);
          addGeneration({
            generationId: data.generationId,
            entityId: data.entityId,
            entityName: data.entityName,
            fieldCount: data.fieldCount,
            provider: data.provider,
            model: data.model,
          });
        },
      }
    );
  };

  // When the queued generation completes and user is still on this field, pre-fill
  useEffect(() => {
    if (!pendingItem) return;
    if (pendingItem.status !== "completed" || !pendingItem.parsedOutput) return;

    const mappings = pendingItem.parsedOutput.fieldMappings;
    if (mappings.length > 0) {
      const m = mappings[0];
      // Status is auto-computed on save, so skip setting it from AI output
      if (m.mappingType) setMappingType(m.mappingType);
      if (m.sourceEntityId) setSourceEntityId(m.sourceEntityId);
      if (m.sourceFieldId) setSourceFieldId(m.sourceFieldId);
      if (m.transform) setTransform(m.transform);
      if (m.defaultValue) setDefaultValue(m.defaultValue);
      if (m.enumMapping) setEnumMapping(m.enumMapping);
      if (m.reasoning) setReasoning(m.reasoning);
      if (m.confidence) setConfidence(m.confidence);
      if (m.notes) setNotes(m.notes);
      setReviewComment(m.reviewComment || null);
      setAutoMapBanner(true);
      setActiveTab("mapping");
    }
    setPendingGenerationId(null);
  }, [pendingItem?.status, pendingItem?.parsedOutput]);

  // Reset form when field changes
  useEffect(() => {
    const m = field.mapping;
    setStatus((m?.status as MappingStatus) || "unmapped");
    setMappingType((m?.mappingType as MappingType) || "");
    setAssigneeId(m?.assigneeId || "");
    setSourceEntityId(m?.sourceEntityId || "");
    setSourceFieldId(m?.sourceFieldId || "");
    setTransform(m?.transform || "");
    setDefaultValue(m?.defaultValue || "");
    setConfidence((m?.confidence as ConfidenceLevel) || "");
    setReasoning("");
    setNotes("");
    setEnumMapping({});
    setAutoMapBanner(false);
    setReviewComment(null);
    setPendingGenerationId(null);
    setActiveTab("mapping");
    setPanelView("tabs");
  }, [field.id, field.mapping]);

  // Show mapping fields when editing an existing mapping OR when creating a new one
  const showMappingFields = !!existing?.id || status !== "unmapped";

  const handleSave = () => {
    if (existing?.id) {
      updateMapping.mutate({
        id: existing.id,
        mappingType: (mappingType as MappingType) || null,
        assigneeId: assigneeId || null,
        sourceEntityId: sourceEntityId || null,
        sourceFieldId: sourceFieldId || null,
        transform: transform || null,
        defaultValue: defaultValue || null,
        enumMapping: Object.keys(enumMapping).length > 0 ? enumMapping : null,
        reasoning: reasoning || null,
        confidence: (confidence as ConfidenceLevel) || null,
        notes: notes || null,
        editedBy: session?.user?.name || session?.user?.email || undefined,
      });
    } else {
      createMapping.mutate({
        targetFieldId: field.id,
        mappingType: (mappingType as MappingType) || undefined,
        assigneeId: assigneeId || undefined,
        sourceEntityId: sourceEntityId || undefined,
        sourceFieldId: sourceFieldId || undefined,
        transform: transform || undefined,
        defaultValue: defaultValue || undefined,
        enumMapping: Object.keys(enumMapping).length > 0 ? enumMapping : undefined,
        reasoning: reasoning || undefined,
        confidence: (confidence as ConfidenceLevel) || undefined,
        notes: notes || undefined,
        reviewComment: reviewComment || undefined,
      });
    }
  };

  const validationLabel = latestValidation
    ? latestValidation.status === "passed"
      ? "Valid"
      : latestValidation.status === "failed"
        ? "Failed"
        : "Error"
    : "Validate";

  const tabs: { id: Tab; label: string; icon?: React.ReactNode }[] = [
    { id: "mapping", label: "Mapping" },
    { id: "generate", label: "Generate", icon: <Sparkles className="h-3 w-3" /> },
    {
      id: "comments",
      label: threadCount > 0 ? `Comments (${threadCount})` : "Comments",
    },
    {
      id: "validation",
      label: validationLabel,
      icon: latestValidation
        ? latestValidation.status === "passed"
          ? <CheckCircle className="h-3 w-3 text-green-600" />
          : latestValidation.status === "failed"
            ? <XCircle className="h-3 w-3 text-red-600" />
            : <FlaskConical className="h-3 w-3 text-amber-600" />
        : <FlaskConical className="h-3 w-3" />,
    },
  ];

  // Format the "last updated by" footer
  const lastUpdatedText = existing?.editedBy && existing?.updatedAt
    ? `Last updated by ${existing.editedBy} on ${new Date(existing.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
    : null;

  const atlasHref = `/atlas?entityId=${entityId}&fieldId=${field.id}${existing?.id ? `&mappingId=${existing.id}` : ""}&from=mapping&fromEntityId=${entityId}`;

  return (
    <div className="w-[420px] border-l bg-background overflow-y-auto shrink-0">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm font-mono min-w-0 truncate">{field.name}</h3>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setPanelView(panelView === "activity" ? "tabs" : "activity")}
              className={cn(
                "relative p-1.5 rounded hover:bg-muted transition-colors",
                panelView === "activity" && "bg-muted text-primary"
              )}
              title="Activity history"
            >
              <History className="h-4 w-4" />
              {activityCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-primary text-primary-foreground text-[9px] font-bold rounded-full h-3.5 min-w-[14px] flex items-center justify-center px-0.5">
                  {activityCount}
                </span>
              )}
            </button>
            <Link
              href={atlasHref}
              className="p-1.5 rounded hover:bg-muted transition-colors"
              title="View in Atlas"
            >
              <Globe className="h-4 w-4" />
            </Link>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-muted transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <p className="text-xs text-muted-foreground">
            {field.dataType || "unknown"}{field.isRequired ? " (required)" : ""}
          </p>
          <Select
            value={field.milestone || ""}
            onChange={(e) =>
              updateField.mutate({
                id: field.id,
                milestone: (e.target.value as Milestone) || null,
              })
            }
            options={[
              { value: "", label: "No milestone" },
              ...MILESTONES.map((m) => ({ value: m, label: MILESTONE_LABELS[m] })),
            ]}
            className="h-6 text-[11px] w-32"
          />
        </div>
        {field.description && (
          <p className="text-xs text-muted-foreground mt-1">{field.description}</p>
        )}
      </div>

      {/* Activity panel takeover */}
      {panelView === "activity" && (
        <div className="flex-1 flex flex-col">
          <button
            onClick={() => setPanelView("tabs")}
            className="flex items-center gap-1.5 px-4 py-2 text-xs text-muted-foreground hover:text-foreground border-b transition-colors"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to mapping
          </button>
          <MappingActivity mappingId={existing?.id} />
        </div>
      )}

      {/* Tab bar + content */}
      {panelView === "tabs" && (
        <>
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
                <span className="flex items-center justify-center gap-1">
                  {tab.icon}
                  {tab.label}
                </span>
              </button>
            ))}
          </div>

      {activeTab === "mapping" && (
        <div className="p-4 space-y-4">
          {/* AI suggestion banner */}
          {autoMapBanner && (
            <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
              AI suggestion — review and save to accept
            </div>
          )}

          {/* Status (read-only — auto-computed) */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Status</label>
            <div>
              <MappingStatusBadge status={status} />
            </div>
          </div>

          {/* Mapping Type — hidden when unmapped */}
          {showMappingFields && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Mapping Type</label>
              <Select
                value={mappingType}
                onChange={(e) => setMappingType(e.target.value as MappingType | "")}
                options={[
                  { value: "", label: "Not set" },
                  ...MAPPING_TYPES.map((t) => ({
                    value: t,
                    label: MAPPING_TYPE_LABELS[t],
                  })),
                ]}
              />
              {mappingType && (
                <p className="text-[11px] text-muted-foreground leading-tight">
                  {MAPPING_TYPE_DESCRIPTIONS[mappingType]}
                </p>
              )}
            </div>
          )}

          {/* Source Field Picker — hidden when unmapped */}
          {showMappingFields && (
            <SourceFieldPicker
              sourceEntityId={sourceEntityId}
              sourceFieldId={sourceFieldId}
              onChangeEntity={setSourceEntityId}
              onChangeField={setSourceFieldId}
            />
          )}

          {/* Transform — hidden when unmapped */}
          {showMappingFields && (
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

          {/* Default Value — hidden when unmapped */}
          {showMappingFields && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Default Value</label>
              <Input
                value={defaultValue}
                onChange={(e) => setDefaultValue(e.target.value)}
                placeholder="Enter default value"
              />
            </div>
          )}

          {/* Enum Mapping — hidden when unmapped */}
          {showMappingFields && field.enumValues && field.enumValues.length > 0 && (
            <EnumMappingEditor
              enumValues={field.enumValues}
              mapping={enumMapping}
              onChange={setEnumMapping}
            />
          )}

          {/* Assignee — always visible */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Assignee</label>
            <Select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              options={[
                { value: "", label: "Unassigned" },
                ...(members || []).map((m) => ({
                  value: m.userId,
                  label: m.name || m.email,
                })),
              ]}
            />
          </div>

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

          {/* Close Case / Re-Open Case */}
          {existing?.id && status !== "accepted" && (
            <Button
              variant="outline"
              onClick={() => closeCase.mutate(existing.id)}
              disabled={closeCase.isPending}
              className="w-full border-green-300 text-green-700 hover:bg-green-50 dark:border-green-700 dark:text-green-400 dark:hover:bg-green-950/30"
            >
              <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
              {closeCase.isPending ? "Accepting..." : "Accept Mapping"}
            </Button>
          )}
          {existing?.id && status === "accepted" && (
            <Button
              variant="outline"
              onClick={() => reopenCase.mutate(existing.id)}
              disabled={reopenCase.isPending}
              className="w-full"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              {reopenCase.isPending ? "Re-opening..." : "Re-Open Case"}
            </Button>
          )}

          {/* Footer: Last updated by */}
          {lastUpdatedText ? (
            <p className="text-xs text-muted-foreground text-center">
              {lastUpdatedText}
            </p>
          ) : existing?.createdBy ? (
            <p className="text-xs text-muted-foreground text-center">
              Created by: {existing.createdBy}
            </p>
          ) : null}
        </div>
      )}

      {activeTab === "generate" && (
        <GenerateTab
          isAutoMapping={isAutoMapping}
          autoMapProvider={autoMapProvider}
          autoMapModel={autoMapModel}
          autoMapBanner={autoMapBanner}
          generationError={runGeneration.error?.message || null}
          isGenerationError={runGeneration.isError}
          onProviderChange={handleProviderChange}
          onModelChange={setAutoMapModel}
          onAutoMap={handleAutoMap}
        />
      )}

      {activeTab === "comments" && (
        <ThreadList
          entityId={entityId}
          fieldMappingId={existing?.id}
          workspaceId={workspaceId}
        />
      )}

      {activeTab === "validation" && (
        <ValidationTab mappingId={existing?.id} />
      )}
        </>
      )}
    </div>
  );
}
