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
import { AnalyticsPanel } from "@/components/admin/analytics-panel";
import { ClientQAPanel } from "@/components/admin/client-qa-panel";

type Tab = "corrections" | "questions" | "client-qa" | "generation" | "linear" | "analytics";
type Workflow = "sdt" | "transfers";

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
  const [workflow, setWorkflow] = useState<Workflow>("sdt");
  const { workspaceId, role } = useWorkspace();
  const qc = useQueryClient();

  if (role !== "owner") {
    return (
      <div className="p-6 lg:p-8 max-w-5xl mx-auto">
        <p className="text-sm text-muted-foreground">You don't have access to the Admin page.</p>
      </div>
    );
  }
  const basePath = workspacePath(workspaceId, "admin");

  // Corrections — fetch all, filter client-side by workflow
  const { data: allPendingLearnings, isLoading: loadingLearnings } = useQuery({
    queryKey: ["admin", "validation", workspaceId],
    queryFn: () => api.get<PendingLearning[]>(`${basePath}/validation?status=pending`),
  });
  // Client-side workflow filter: "client" source = client Q&A, "review" = SDT/transfer review verdicts
  // Transfer learnings aren't distinguishable from SDT yet, so show all for both workflows
  const pendingLearnings = allPendingLearnings?.map((l) => ({
    ...l,
    isClientSource: l.source === "client",
  }));

  const validateMutation = useMutation({
    mutationFn: (input: { learningId: string; action: "validate" | "reject" }) =>
      api.patch(`${basePath}/validation`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "validation"] });
    },
  });

  // Questions — fetch all, filter client-side by workflow
  const { data: allDraftQuestions, isLoading: loadingQuestions } = useQuery({
    queryKey: ["admin", "questions", workspaceId],
    queryFn: () => api.get<DraftQuestion[]>(`${basePath}/questions?status=draft`),
  });
  const draftQuestions = allDraftQuestions;

  const curateMutation = useMutation({
    mutationFn: (input: { questionId: string; action: "approve" | "reject" | "duplicate"; duplicateOf?: string; editedQuestion?: string }) =>
      api.patch(`${basePath}/questions`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "questions"] });
    },
  });

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Admin: Validation & Curation</h1>
        <div className="flex rounded-lg border p-0.5 bg-muted/50">
          <button
            onClick={() => { setWorkflow("sdt"); setTab("corrections"); }}
            className={cn(
              "px-3 py-1 text-xs font-medium rounded-md transition-colors",
              workflow === "sdt"
                ? "bg-background shadow text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            SDT Mappings
          </button>
          <button
            onClick={() => { setWorkflow("transfers"); setTab("corrections"); }}
            className={cn(
              "px-3 py-1 text-xs font-medium rounded-md transition-colors",
              workflow === "transfers"
                ? "bg-background shadow text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Servicing Transfers
          </button>
        </div>
      </div>

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
        {workflow === "sdt" && (
          <>
            <button
              onClick={() => setTab("client-qa")}
              className={cn(
                "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
                tab === "client-qa"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              Client Q&A
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
          </>
        )}
        <button
          onClick={() => setTab("analytics")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
            tab === "analytics"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          Analytics
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
                  {l.source === "client" && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 ml-2">
                      Client answer
                    </span>
                  )}
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
        <QuestionsTab
          questions={draftQuestions}
          isLoading={loadingQuestions}
          onAction={(questionId, action, opts) =>
            curateMutation.mutate({ questionId, action, ...opts })
          }
          isPending={curateMutation.isPending}
        />
      )}

      {/* Client Q&A tab */}
      {tab === "client-qa" && (
        <ClientQAPanel />
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

      {/* Analytics tab */}
      {tab === "analytics" && (
        <AnalyticsPanel />
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
              <div className="flex gap-1 shrink-0">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[10px] text-green-600"
                  onClick={() => onAction("duplicate", { duplicateOf: sq.id })}
                  disabled={isPending}
                  title="Yes, this is a duplicate — merge into the existing question"
                >
                  <Check className="h-3 w-3 mr-0.5" />
                  Duplicate
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[10px] text-muted-foreground"
                  onClick={() => {/* Not a duplicate — just dismiss the suggestion */}}
                  disabled={isPending}
                  title="Not a duplicate — keep both questions"
                >
                  <X className="h-3 w-3 mr-0.5" />
                  Not dup
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function QuestionsTab({
  questions,
  isLoading,
  onAction,
  isPending,
}: {
  questions: DraftQuestion[] | undefined;
  isLoading: boolean;
  onAction: (questionId: string, action: "approve" | "reject" | "duplicate", opts?: { duplicateOf?: string; editedQuestion?: string }) => void;
  isPending: boolean;
}) {
  const [sourceFilter, setSourceFilter] = useState<"all" | "user" | "llm" | "validator">("all");

  const filtered = questions?.filter((q) => {
    if (sourceFilter === "all") return true;
    return q.askedBy === sourceFilter;
  });

  const counts = {
    all: questions?.length || 0,
    user: questions?.filter((q) => q.askedBy === "user").length || 0,
    llm: questions?.filter((q) => q.askedBy === "llm").length || 0,
    validator: questions?.filter((q) => q.askedBy === "validator").length || 0,
  };

  return (
    <div className="space-y-3">
      {/* Source filter */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Source:</span>
        {(["all", "user", "llm", "validator"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setSourceFilter(f)}
            className={cn(
              "px-2 py-0.5 text-xs rounded transition-colors",
              sourceFilter === f
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            {f === "all" ? "All" : f === "user" ? "Reviewer" : f === "llm" ? "AI" : "Validator"}{" "}
            ({counts[f]})
          </button>
        ))}
      </div>

      {isLoading && (
        <p className="text-sm text-muted-foreground">Loading draft questions...</p>
      )}
      {filtered?.length === 0 && (
        <p className="text-sm text-muted-foreground">No draft questions to curate.</p>
      )}
      {filtered?.map((q) => (
        <DraftQuestionCard
          key={q.id}
          question={q}
          onAction={(action, opts) => onAction(q.id, action, opts)}
          isPending={isPending}
        />
      ))}
    </div>
  );
}
