"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ContextAttachSheet } from "./context-attach-sheet";
import {
  useMappingContexts,
  useAddMappingContext,
  useRemoveMappingContext,
} from "@/queries/mapping-queries";
import { useMatchingSkills } from "@/queries/skill-queries";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Link2,
  Layers,
  Plus,
  X,
} from "lucide-react";
import { SKILL_CONTEXT_ROLE_LABELS, type SkillContextRole } from "@/lib/constants";

interface MappingContextTabProps {
  mappingId: string | undefined;
  entityName: string;
  fieldName: string;
  dataType: string | null;
}

export function MappingContextTab({
  mappingId,
  entityName,
  fieldName,
  dataType,
}: MappingContextTabProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [expandedSkills, setExpandedSkills] = useState<Set<string>>(
    new Set()
  );

  const { data: linkedContexts } = useMappingContexts(mappingId);
  const { data: matchingSkills } = useMatchingSkills(
    entityName,
    fieldName,
    dataType || undefined
  );
  const addContext = useAddMappingContext();
  const removeContext = useRemoveMappingContext();

  const linkedIds = new Set(
    (linkedContexts || [])
      .filter((mc) => mc.contextId)
      .map((mc) => mc.contextId!)
  );

  const handleAttach = (contextId: string) => {
    if (!mappingId) return;
    addContext.mutate({ mappingId, contextId });
    setSheetOpen(false);
  };

  const handleRemove = (mcId: string) => {
    if (!mappingId) return;
    removeContext.mutate({ mappingId, mcId });
  };

  const toggleSkillExpand = (id: string) => {
    setExpandedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!mappingId) {
    return (
      <div className="p-4 text-center">
        <p className="text-xs text-muted-foreground">
          Save a mapping first to attach context documents.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-5">
      {/* Linked Contexts */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Link2 className="h-3 w-3" />
            Linked Contexts
          </h4>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => setSheetOpen(true)}
          >
            <Plus className="h-3 w-3 mr-1" />
            Attach
          </Button>
        </div>

        {!linkedContexts || linkedContexts.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No contexts linked to this mapping.
          </p>
        ) : (
          <div className="space-y-1">
            {linkedContexts.map((mc) => (
              <div
                key={mc.id}
                className="flex items-start gap-2 py-1.5 px-2 rounded border text-sm"
              >
                <BookOpen className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">
                    {mc.contextName || "Unknown"}
                  </p>
                  {mc.contextPreview && (
                    <p className="text-[10px] text-muted-foreground line-clamp-1">
                      {mc.contextPreview}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => handleRemove(mc.id)}
                  className="p-0.5 rounded hover:bg-muted shrink-0"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Matching Skills */}
      {matchingSkills && matchingSkills.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2">
            <Layers className="h-3 w-3" />
            Matching Skills
          </h4>
          <div className="space-y-1">
            {matchingSkills.map((sk) => {
              const isExpanded = expandedSkills.has(sk.id);
              return (
                <div key={sk.id} className="border rounded">
                  <button
                    onClick={() => toggleSkillExpand(sk.id)}
                    className="w-full flex items-center gap-2 py-1.5 px-2 text-sm hover:bg-muted/50 transition-colors text-left"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate flex-1">{sk.name}</span>
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {sk.contexts?.length ?? 0}
                    </Badge>
                  </button>
                  {isExpanded && sk.contexts && (
                    <div className="border-t px-2 py-1 space-y-0.5">
                      {sk.contexts.map((sc) => (
                        <div
                          key={sc.id}
                          className="flex items-center gap-2 py-0.5 text-xs text-muted-foreground"
                        >
                          <BookOpen className="h-3 w-3 shrink-0" />
                          <span className="truncate flex-1">
                            {sc.context?.name || "Unknown"}
                          </span>
                          <Badge
                            variant="secondary"
                            className="text-[9px] shrink-0"
                          >
                            {SKILL_CONTEXT_ROLE_LABELS[sc.role as SkillContextRole] || sc.role}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Attach Sheet */}
      <ContextAttachSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onAttach={handleAttach}
        excludeIds={linkedIds}
      />
    </div>
  );
}
