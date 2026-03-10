"use client";

import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Upload,
  Pencil,
  X,
  Check,
  Loader2,
  CheckCircle,
  AlertTriangle,
  XCircle,
} from "lucide-react";

interface QuestionRow {
  question: {
    id: string;
    question: string;
    entityId: string | null;
    fieldId: string | null;
    curationStatus: string;
    askedBy: string;
    createdAt: string;
  };
  entityName: string | null;
  fieldName: string | null;
  fieldDataType: string | null;
  fieldDescription: string | null;
}

interface EntityGroup {
  entityId: string;
  entityName: string;
  questions: QuestionRow[];
}

interface ClientQAData {
  total: number;
  groups: EntityGroup[];
}

interface ImportResult {
  resolved: number;
  skipped: number;
  unmatched: string[];
  errors: string[];
  total: number;
}

export function ClientQAPanel() {
  const { workspaceId } = useWorkspace();
  const { addToast } = useToast();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [collapsedEntities, setCollapsedEntities] = useState<Set<string>>(new Set());
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const basePath = workspacePath(workspaceId, "admin/client-qa");

  const { data, isLoading } = useQuery<ClientQAData>({
    queryKey: ["admin", "client-qa", workspaceId],
    queryFn: () => api.get(`${basePath}?status=all`),
  });

  const exportMutation = useMutation({
    mutationFn: async (input: { questionIds: string[]; edits: Record<string, string> }) => {
      const res = await fetch(`/api/workspaces/${workspaceId}/admin/client-qa/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error("Export failed");
      return res;
    },
    onSuccess: async (res) => {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.headers.get("Content-Disposition")?.split("filename=")[1]?.replace(/"/g, "") || "client-questions.xlsx";
      a.click();
      URL.revokeObjectURL(url);
      setSelectedIds(new Set());
      setEdits({});
      qc.invalidateQueries({ queryKey: ["admin", "client-qa"] });
      addToast({ type: "success", title: `Exported ${selectedIds.size} questions` });
    },
    onError: () => addToast({ type: "error", title: "Export failed" }),
  });

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/workspaces/${workspaceId}/admin/client-qa/import`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("Import failed");
      return res.json() as Promise<ImportResult>;
    },
    onSuccess: (result) => {
      setImportResult(result);
      qc.invalidateQueries({ queryKey: ["admin", "client-qa"] });
      qc.invalidateQueries({ queryKey: ["admin", "validation"] });
      addToast({
        type: result.errors.length > 0 ? "error" : "success",
        title: `Imported: ${result.resolved} resolved, ${result.skipped} skipped`,
      });
    },
    onError: () => addToast({ type: "error", title: "Import failed" }),
  });

  const rejectMutation = useMutation({
    mutationFn: (questionId: string) =>
      api.patch(workspacePath(workspaceId, "admin/questions"), {
        questionId,
        action: "reject",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "client-qa"] }),
  });

  const allQuestionIds = useMemo(() => {
    if (!data) return [];
    return data.groups.flatMap((g) => g.questions.map((q) => q.question.id));
  }, [data]);

  const draftCount = useMemo(() => {
    if (!data) return 0;
    return data.groups.reduce((sum, g) =>
      sum + g.questions.filter((q) => q.question.curationStatus === "draft").length, 0);
  }, [data]);

  const approvedCount = useMemo(() => {
    if (!data) return 0;
    return data.groups.reduce((sum, g) =>
      sum + g.questions.filter((q) => q.question.curationStatus === "approved").length, 0);
  }, [data]);

  const toggleAll = () => {
    if (selectedIds.size === allQuestionIds.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allQuestionIds));
    }
  };

  const toggleEntity = (entityQuestions: QuestionRow[]) => {
    const ids = entityQuestions.map((q) => q.question.id);
    const allSelected = ids.every((id) => selectedIds.has(id));
    const next = new Set(selectedIds);
    for (const id of ids) {
      if (allSelected) next.delete(id); else next.add(id);
    }
    setSelectedIds(next);
  };

  const toggleQuestion = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  const handleExport = () => {
    if (selectedIds.size === 0) return;
    exportMutation.mutate({
      questionIds: Array.from(selectedIds),
      edits,
    });
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) importMutation.mutate(file);
    e.target.value = "";
  };

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading questions...</p>;
  }

  return (
    <div className="space-y-4">
      {/* Summary + actions bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-sm">
          <span>{data?.total || 0} open questions</span>
          {draftCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs">
              {draftCount} draft
            </span>
          )}
          {approvedCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs">
              {approvedCount} approved (exported)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={importMutation.isPending}
          >
            {importMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5 mr-1.5" />
            )}
            Import Answers
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleImport}
            className="hidden"
          />
          <Button
            size="sm"
            onClick={handleExport}
            disabled={selectedIds.size === 0 || exportMutation.isPending}
          >
            {exportMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5 mr-1.5" />
            )}
            Export {selectedIds.size > 0 ? `(${selectedIds.size})` : "Selected"}
          </Button>
        </div>
      </div>

      {/* Import results */}
      {importResult && (
        <div className="border rounded-lg p-3 space-y-1 text-sm">
          <div className="flex items-center gap-2 font-medium">Import Results</div>
          <div className="flex items-center gap-1.5 text-green-700">
            <CheckCircle className="h-3.5 w-3.5" />
            {importResult.resolved} questions resolved with client answers
          </div>
          {importResult.skipped > 0 && (
            <div className="flex items-center gap-1.5 text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5" />
              {importResult.skipped} skipped (already resolved)
            </div>
          )}
          {importResult.unmatched.length > 0 && (
            <div className="flex items-center gap-1.5 text-red-700">
              <XCircle className="h-3.5 w-3.5" />
              {importResult.unmatched.length} could not be matched
            </div>
          )}
          {importResult.errors.length > 0 && (
            <div className="text-red-600 text-xs mt-1">
              {importResult.errors.slice(0, 5).map((e, i) => <p key={i}>{e}</p>)}
            </div>
          )}
          {importResult.resolved > 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              Client answers are now pending validation in the Corrections tab.
            </p>
          )}
          <button
            onClick={() => setImportResult(null)}
            className="text-xs text-muted-foreground hover:text-foreground mt-1"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Select all */}
      {(data?.total || 0) > 0 && (
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={selectedIds.size === allQuestionIds.length && allQuestionIds.length > 0}
            ref={(el) => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < allQuestionIds.length; }}
            onChange={toggleAll}
            className="h-3.5 w-3.5 rounded"
          />
          <span className="text-xs text-muted-foreground">
            {selectedIds.size === allQuestionIds.length ? "Deselect all" : "Select all"}
          </span>
        </div>
      )}

      {/* Entity groups */}
      {data?.groups.map((group) => {
        const isCollapsed = collapsedEntities.has(group.entityId);
        const entitySelected = group.questions.every((q) => selectedIds.has(q.question.id));
        const entityPartial = group.questions.some((q) => selectedIds.has(q.question.id)) && !entitySelected;

        return (
          <div key={group.entityId} className="border rounded-lg">
            <div
              className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/30"
              onClick={() => {
                const next = new Set(collapsedEntities);
                if (isCollapsed) next.delete(group.entityId); else next.add(group.entityId);
                setCollapsedEntities(next);
              }}
            >
              <input
                type="checkbox"
                checked={entitySelected}
                ref={(el) => { if (el) el.indeterminate = entityPartial; }}
                onChange={(e) => { e.stopPropagation(); toggleEntity(group.questions); }}
                onClick={(e) => e.stopPropagation()}
                className="h-3.5 w-3.5 rounded"
              />
              {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              <span className="font-medium text-sm">{group.entityName}</span>
              <span className="text-xs text-muted-foreground">{group.questions.length} questions</span>
            </div>

            {!isCollapsed && (
              <div className="px-3 pb-2 space-y-1.5">
                {group.questions.map((row) => {
                  const q = row.question;
                  const isEditing = editingId === q.id;
                  const editedText = edits[q.id] ?? q.question;

                  return (
                    <div key={q.id} className={cn(
                      "flex items-start gap-2 p-2 rounded text-sm",
                      q.curationStatus === "approved" ? "bg-green-50/50" : "bg-background",
                    )}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(q.id)}
                        onChange={() => toggleQuestion(q.id)}
                        className="h-3.5 w-3.5 rounded mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-0.5">
                          {row.fieldName && <span className="font-medium">{row.fieldName}</span>}
                          {row.fieldDataType && <span>({row.fieldDataType})</span>}
                          {q.curationStatus === "approved" && (
                            <span className="text-green-600 font-medium">exported</span>
                          )}
                        </div>
                        {isEditing ? (
                          <textarea
                            value={editedText}
                            onChange={(e) => setEdits({ ...edits, [q.id]: e.target.value })}
                            rows={2}
                            className="w-full rounded border bg-background px-2 py-1 text-sm resize-none"
                            autoFocus
                          />
                        ) : (
                          <p className="text-sm">{edits[q.id] || q.question}</p>
                        )}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={() => setEditingId(isEditing ? null : q.id)}
                          className="p-1 rounded hover:bg-muted"
                          title="Edit question text"
                        >
                          {isEditing ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Pencil className="h-3.5 w-3.5 text-muted-foreground" />}
                        </button>
                        <button
                          onClick={() => rejectMutation.mutate(q.id)}
                          className="p-1 rounded hover:bg-red-50"
                          title="Reject (remove from list)"
                        >
                          <X className="h-3.5 w-3.5 text-muted-foreground hover:text-red-500" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {data?.total === 0 && (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No open questions to curate. Questions are surfaced during generation and review.
        </p>
      )}
    </div>
  );
}
