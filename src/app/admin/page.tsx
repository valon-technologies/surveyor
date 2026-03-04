"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { cn } from "@/lib/utils";
import { Check, X, Copy, Pencil, ArrowDownToLine, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BatchRunPanel } from "@/components/review/batch-run-panel";
import { LinearSyncPanel } from "@/components/admin/linear-sync-panel";

type Tab = "corrections" | "questions" | "generation" | "linear";

interface PendingLearning {
  id: string;
  entityId: string | null;
  entityName: string | null;
  fieldName: string | null;
  content: string;
  source: string;
  validationStatus: string;
  createdAt: string;
}

interface DraftQuestion {
  id: string;
  question: string;
  entityId: string | null;
  entityName: string | null;
  fieldName: string | null;
  targetForTeam: string | null;
  askedBy: string;
  curationStatus: string;
  createdAt: string;
  similarQuestions: { id: string; question: string }[];
}

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("corrections");
  const { workspaceId } = useWorkspace();
  const qc = useQueryClient();
  const basePath = workspacePath(workspaceId, "admin");

  // Corrections
  const { data: pendingLearnings, isLoading: loadingLearnings } = useQuery({
    queryKey: ["admin", "validation", workspaceId],
    queryFn: () => api.get<PendingLearning[]>(`${basePath}/validation?status=pending`),
  });

  const validateMutation = useMutation({
    mutationFn: (input: { learningId: string; action: "validate" | "reject" }) =>
      api.patch(`${basePath}/validation`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "validation"] });
    },
  });

  // Questions
  const { data: draftQuestions, isLoading: loadingQuestions } = useQuery({
    queryKey: ["admin", "questions", workspaceId],
    queryFn: () => api.get<DraftQuestion[]>(`${basePath}/questions?status=draft`),
  });

  const curateMutation = useMutation({
    mutationFn: (input: { questionId: string; action: "approve" | "reject" | "duplicate"; duplicateOf?: string; editedQuestion?: string }) =>
      api.patch(`${basePath}/questions`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "questions"] });
    },
  });

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Admin: Validation & Curation</h1>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        <button
          onClick={() => setTab("corrections")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
            tab === "corrections"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          Corrections
          {pendingLearnings && pendingLearnings.length > 0 && (
            <span className="ml-2 px-1.5 py-0.5 text-[10px] rounded-full bg-amber-100 text-amber-700">
              {pendingLearnings.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("questions")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
            tab === "questions"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          Questions
          {draftQuestions && draftQuestions.length > 0 && (
            <span className="ml-2 px-1.5 py-0.5 text-[10px] rounded-full bg-amber-100 text-amber-700">
              {draftQuestions.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("generation")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
            tab === "generation"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          Generation
        </button>
        <button
          onClick={() => setTab("linear")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
            tab === "linear"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          Linear Sync
        </button>
      </div>

      {/* Corrections tab */}
      {tab === "corrections" && (
        <div className="space-y-3">
          {loadingLearnings && (
            <p className="text-sm text-muted-foreground">Loading pending corrections...</p>
          )}
          {pendingLearnings?.length === 0 && (
            <p className="text-sm text-muted-foreground">No pending corrections to validate.</p>
          )}
          {pendingLearnings?.map((l) => (
            <div key={l.id} className="border rounded-lg p-4 space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-xs font-medium text-muted-foreground">
                    {l.entityName || "Unknown entity"}
                    {l.fieldName && `.${l.fieldName}`}
                  </span>
                  <span className="text-[10px] text-muted-foreground ml-2">
                    {new Date(l.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs text-green-700 border-green-300 hover:bg-green-50"
                    onClick={() => validateMutation.mutate({ learningId: l.id, action: "validate" })}
                    disabled={validateMutation.isPending}
                  >
                    <Check className="h-3 w-3 mr-1" />
                    Validate
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs text-red-700 border-red-300 hover:bg-red-50"
                    onClick={() => validateMutation.mutate({ learningId: l.id, action: "reject" })}
                    disabled={validateMutation.isPending}
                  >
                    <X className="h-3 w-3 mr-1" />
                    Reject
                  </Button>
                </div>
              </div>
              <p className="text-sm whitespace-pre-wrap">{l.content}</p>
            </div>
          ))}
        </div>
      )}

      {/* Questions tab */}
      {tab === "questions" && (
        <div className="space-y-3">
          {loadingQuestions && (
            <p className="text-sm text-muted-foreground">Loading draft questions...</p>
          )}
          {draftQuestions?.length === 0 && (
            <p className="text-sm text-muted-foreground">No draft questions to curate.</p>
          )}
          {draftQuestions?.map((q) => (
            <DraftQuestionCard
              key={q.id}
              question={q}
              onAction={(action, opts) =>
                curateMutation.mutate({ questionId: q.id, action, ...opts })
              }
              isPending={curateMutation.isPending}
            />
          ))}
        </div>
      )}

      {/* Generation tab */}
      {tab === "generation" && (
        <div className="space-y-3">
          <BatchRunPanel />
        </div>
      )}

      {/* Linear Sync tab */}
      {tab === "linear" && (
        <LinearSyncPanel />
      )}
    </div>
  );
}

function DraftQuestionCard({
  question: q,
  onAction,
  isPending,
}: {
  question: DraftQuestion;
  onAction: (
    action: "approve" | "reject" | "duplicate",
    opts?: { duplicateOf?: string; editedQuestion?: string }
  ) => void;
  isPending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editedText, setEditedText] = useState(q.question);

  return (
    <div className="border rounded-lg p-4 space-y-2">
      <div className="flex items-start justify-between">
        <div>
          <span className="text-xs font-medium text-muted-foreground">
            {q.entityName || "Unknown entity"}
            {q.fieldName && `.${q.fieldName}`}
          </span>
          <span className="text-[10px] text-muted-foreground ml-2">
            {q.askedBy === "llm" ? "AI-generated" : "Reviewer"} · {q.targetForTeam || "—"}
          </span>
        </div>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => setEditing(!editing)}
          >
            <Pencil className="h-3 w-3 mr-1" />
            Edit
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs text-green-700 border-green-300 hover:bg-green-50"
            onClick={() =>
              onAction("approve", editing && editedText !== q.question ? { editedQuestion: editedText } : undefined)
            }
            disabled={isPending}
          >
            <Check className="h-3 w-3 mr-1" />
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs text-red-700 border-red-300 hover:bg-red-50"
            onClick={() => onAction("reject")}
            disabled={isPending}
          >
            <X className="h-3 w-3 mr-1" />
            Reject
          </Button>
        </div>
      </div>

      {editing ? (
        <textarea
          value={editedText}
          onChange={(e) => setEditedText(e.target.value)}
          rows={3}
          className="w-full text-sm rounded border bg-background px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
        />
      ) : (
        <p className="text-sm whitespace-pre-wrap">{q.question}</p>
      )}

      {/* Similar questions for dedup */}
      {q.similarQuestions.length > 0 && (
        <div className="border-t pt-2 mt-2">
          <span className="text-[10px] font-semibold text-amber-600 uppercase tracking-wider">
            Possible duplicates ({q.similarQuestions.length})
          </span>
          {q.similarQuestions.map((sq) => (
            <div key={sq.id} className="flex items-start gap-2 mt-1.5">
              <p className="text-xs text-muted-foreground flex-1">{sq.question}</p>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[10px] text-amber-600 shrink-0"
                onClick={() => onAction("duplicate", { duplicateOf: sq.id })}
                disabled={isPending}
              >
                <Copy className="h-3 w-3 mr-1" />
                Mark duplicate
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
