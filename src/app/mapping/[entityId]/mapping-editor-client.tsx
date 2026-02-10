"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useEntity } from "@/queries/entity-queries";
import { useThreads } from "@/queries/thread-queries";
import { useMappingStore } from "@/stores/mapping-store";
import { EntityHeader } from "@/components/mapping/entity-header";
import { FieldTable } from "@/components/mapping/field-table";
import { MappingDetailPanel } from "@/components/mapping/mapping-detail-panel";
import { AutoMapReviewSheet } from "@/components/mapping/auto-map-review-sheet";
import { ThreadList } from "@/components/threads/thread-list";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft, MessageSquare, X } from "lucide-react";

export function MappingEditorClient({ entityId }: { entityId: string }) {
  const searchParams = useSearchParams();
  const { data: entity, isLoading } = useEntity(entityId);
  const { selectedFieldId, setSelectedFieldId, autoMapSheetOpen, setAutoMapSheetOpen } = useMappingStore();

  // Re-select field when returning from Atlas
  useEffect(() => {
    const fieldId = searchParams.get("fieldId");
    if (fieldId) {
      setSelectedFieldId(fieldId);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [showEntityThreads, setShowEntityThreads] = useState(false);

  const { data: entityThreads } = useThreads({ entityId });
  const openThreadCount = entityThreads?.filter((t) => t.status === "open").length ?? 0;

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading entity...</div>
      </div>
    );
  }

  if (!entity) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">Entity not found</p>
          <Link href="/mapping" className="text-sm text-primary hover:underline mt-2 inline-block">
            Back to mapping
          </Link>
        </div>
      </div>
    );
  }

  const selectedField = entity.fields.find((f) => f.id === selectedFieldId);

  return (
    <div className="h-screen flex flex-col">
      {/* Top bar */}
      <div className="border-b px-4 py-2 flex items-center gap-3">
        <Link
          href="/mapping"
          className="p-1.5 rounded hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <EntityHeader entity={entity} />
        <Button
          size="sm"
          variant={showEntityThreads ? "default" : "outline"}
          onClick={() => {
            setShowEntityThreads(!showEntityThreads);
            if (!showEntityThreads) setSelectedFieldId(null);
          }}
          className="shrink-0 text-xs h-8"
        >
          <MessageSquare className="h-3.5 w-3.5 mr-1" />
          Threads
          {openThreadCount > 0 && (
            <span className="ml-1 bg-primary-foreground/20 text-[10px] rounded-full px-1.5">
              {openThreadCount}
            </span>
          )}
        </Button>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <FieldTable
            fields={entity.fields}
            selectedFieldId={selectedFieldId}
            onSelectField={(id) => {
              setSelectedFieldId(id);
              setShowEntityThreads(false);
            }}
          />
        </div>

        {/* Entity-level threads panel */}
        {showEntityThreads && (
          <div className="w-[420px] border-l bg-background overflow-y-auto shrink-0">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-semibold text-sm">Entity Threads</h3>
              <button
                onClick={() => setShowEntityThreads(false)}
                className="p-1 rounded hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <ThreadList
              entityId={entityId}
              workspaceId={entity.workspaceId}
            />
          </div>
        )}

        {/* Right-side detail panel */}
        {selectedField && !showEntityThreads && (
          <MappingDetailPanel
            field={selectedField}
            entityId={entityId}
            entityName={entity.name}
            workspaceId={entity.workspaceId}
            onClose={() => setSelectedFieldId(null)}
          />
        )}
      </div>

      {/* Batch Auto-Map review sheet */}
      <AutoMapReviewSheet
        open={autoMapSheetOpen}
        onClose={() => setAutoMapSheetOpen(false)}
        entityId={entityId}
        entityName={entity.displayName || entity.name}
        fields={entity.fields}
      />
    </div>
  );
}
