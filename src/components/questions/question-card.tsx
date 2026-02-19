"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import {
  ChevronDown,
  ChevronRight,
  MessageSquare,
  CheckCircle2,
  RotateCcw,
  X,
  UserPlus,
  Check,
} from "lucide-react";
import {
  useUpdateQuestion,
  useQuestionReplies,
  useCreateQuestionReply,
  useResolveQuestion,
  useReopenQuestion,
} from "@/queries/question-queries";
import { SchemaAttachButton } from "@/components/questions/schema-attach-button";
import { useWorkspaceMembers } from "@/queries/member-queries";
import {
  QUESTION_PRIORITY_LABELS,
  QUESTION_PRIORITY_COLORS,
  QUESTION_PRIORITIES,
  QUESTION_STATUS_LABELS,
  QUESTION_STATUS_COLORS,
} from "@/lib/constants";
import type { Question, QuestionReply } from "@/types/question";
import type { QuestionPriority, QuestionStatus } from "@/lib/constants";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function ReplyBubble({ reply }: { reply: QuestionReply }) {
  const isAI = reply.authorRole === "llm";
  const initial = isAI ? "AI" : reply.authorName.charAt(0).toUpperCase();
  return (
    <div className="flex gap-2.5 py-2">
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium shrink-0 ${
          isAI ? "bg-violet-100 text-violet-700" : "bg-muted"
        }`}
      >
        {initial}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs font-medium">{reply.authorName}</span>
          {reply.authorRole !== "user" && (
            <Badge variant="outline" className="text-[9px] px-1 py-0">
              {reply.authorRole}
            </Badge>
          )}
          <span className="text-[10px] text-muted-foreground">
            {timeAgo(reply.createdAt)}
          </span>
          {reply.isResolution && (
            <Badge className="text-[9px] px-1.5 py-0 bg-green-100 text-green-700 border-green-200">
              Resolution
            </Badge>
          )}
        </div>
        <p className="text-sm whitespace-pre-wrap">{reply.body}</p>
      </div>
    </div>
  );
}

function ReplyForm({
  questionId,
  onResolve,
  isResolving,
}: {
  questionId: string;
  onResolve: (body: string) => void;
  isResolving: boolean;
}) {
  const [body, setBody] = useState("");
  const createReply = useCreateQuestionReply(questionId);

  const handleReply = () => {
    if (!body.trim()) return;
    createReply.mutate({ body: body.trim() }, { onSuccess: () => setBody("") });
  };

  const handleResolve = () => {
    onResolve(body.trim());
    setBody("");
  };

  return (
    <div className="space-y-2 pt-2 border-t">
      <textarea
        className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm min-h-[60px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
        placeholder="Type a reply..."
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={handleReply}
          disabled={!body.trim() || createReply.isPending}
        >
          Reply
        </Button>
        <Button
          size="sm"
          onClick={handleResolve}
          disabled={isResolving}
          className="gap-1"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          {body.trim() ? "Resolve with Note" : "Resolve"}
        </Button>
      </div>
    </div>
  );
}

interface QuestionCardProps {
  question: Question;
}

export function QuestionCard({ question: q }: QuestionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false);
  const updateMutation = useUpdateQuestion();
  const { data: members } = useWorkspaceMembers();
  const resolveMutation = useResolveQuestion();
  const reopenMutation = useReopenQuestion();

  const { data: replies, isLoading: repliesLoading } = useQuestionReplies(
    expanded ? q.id : null
  );

  const priorityColor =
    QUESTION_PRIORITY_COLORS[q.priority as QuestionPriority] || "#6b7280";
  const statusColor =
    QUESTION_STATUS_COLORS[q.status as QuestionStatus] || "#6b7280";

  const handlePriorityChange = (priority: string) => {
    updateMutation.mutate({ id: q.id, priority });
  };

  const handleDismiss = () => {
    updateMutation.mutate({ id: q.id, status: "dismissed" });
  };

  const handleResolve = (body: string) => {
    resolveMutation.mutate({ id: q.id, body: body || undefined });
  };

  const handleReopen = () => {
    reopenMutation.mutate(q.id);
  };

  const toggleAssignee = (userId: string) => {
    const current = q.assigneeIds ?? [];
    const next = current.includes(userId)
      ? current.filter((id) => id !== userId)
      : [...current, userId];
    updateMutation.mutate({ id: q.id, assigneeIds: next.length > 0 ? next : null });
  };

  const isOpen = q.status === "open";
  const isResolved = q.status === "resolved";

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {/* Entity.field breadcrumb with team badge */}
            {(q.entityName || q.fieldName || q.targetForTeam) && (
              <div className="flex items-center gap-1.5 mb-1.5 text-xs text-muted-foreground font-mono">
                {q.targetForTeam && (
                  <Badge variant="secondary" className="text-[10px] font-sans">
                    {q.targetForTeam}
                  </Badge>
                )}
                {q.entityName && <span>{q.entityName}</span>}
                {q.entityName && q.fieldName && (
                  <span className="text-muted-foreground/50">.</span>
                )}
                {q.fieldName && (
                  <span className="text-foreground/70">{q.fieldName}</span>
                )}
              </div>
            )}

            {/* Badges row */}
            <div className="flex items-center gap-2 mb-1">
              <Badge
                variant="outline"
                className="text-[10px] shrink-0"
                style={{ borderColor: priorityColor, color: priorityColor }}
              >
                {QUESTION_PRIORITY_LABELS[q.priority as QuestionPriority] ||
                  q.priority}
              </Badge>
              <Badge
                variant="outline"
                className="text-[10px]"
                style={{ borderColor: statusColor, color: statusColor }}
              >
                {QUESTION_STATUS_LABELS[q.status as QuestionStatus] || q.status}
              </Badge>
            </div>

            {/* Question text */}
            <p className="text-sm font-medium">{q.question}</p>

            {/* Schema attachments */}
            {q.schemaAssets && q.schemaAssets.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {q.schemaAssets.map((s) => (
                  <Badge
                    key={s.id}
                    variant="secondary"
                    className="text-[10px] gap-1"
                  >
                    {s.name}{" "}
                    <span className="text-muted-foreground/60">{s.side}</span>
                    {isOpen && (
                      <X
                        className="h-3 w-3 cursor-pointer hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          const next = (q.schemaAssetIds ?? []).filter(
                            (id) => id !== s.id
                          );
                          updateMutation.mutate({
                            id: q.id,
                            schemaAssetIds: next.length > 0 ? next : null,
                          });
                        }}
                      />
                    )}
                  </Badge>
                ))}
              </div>
            )}

            {/* Assignees */}
            <div className="flex items-center gap-1.5 mt-2">
              {q.assignees && q.assignees.length > 0 && (
                <div className="flex -space-x-1.5">
                  {q.assignees.map((a) => (
                    <div
                      key={a.userId}
                      title={a.name || a.email}
                      className="w-6 h-6 rounded-full bg-primary/10 text-primary border-2 border-background flex items-center justify-center text-[10px] font-medium"
                    >
                      {a.image ? (
                        <img
                          src={a.image}
                          alt=""
                          className="w-full h-full rounded-full object-cover"
                        />
                      ) : (
                        (a.name || a.email).charAt(0).toUpperCase()
                      )}
                    </div>
                  ))}
                </div>
              )}
              {isOpen && (
                <div className="relative">
                  <button
                    className="w-6 h-6 rounded-full border border-dashed border-muted-foreground/40 flex items-center justify-center text-muted-foreground hover:border-foreground hover:text-foreground transition-colors"
                    onClick={() => setShowAssigneeDropdown(!showAssigneeDropdown)}
                    title="Assign members"
                  >
                    <UserPlus className="h-3 w-3" />
                  </button>
                  {showAssigneeDropdown && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setShowAssigneeDropdown(false)}
                      />
                      <div className="absolute left-0 top-8 z-20 w-56 rounded-md border bg-popover p-1 shadow-md">
                        {members && members.length > 0 ? (
                          members.map((m) => {
                            const assigned = (q.assigneeIds ?? []).includes(m.userId);
                            return (
                              <button
                                key={m.userId}
                                className="flex items-center gap-2 w-full rounded-sm px-2 py-1.5 text-sm hover:bg-accent text-left"
                                onClick={() => toggleAssignee(m.userId)}
                              >
                                <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium shrink-0">
                                  {m.image ? (
                                    <img
                                      src={m.image}
                                      alt=""
                                      className="w-full h-full rounded-full object-cover"
                                    />
                                  ) : (
                                    (m.name || m.email).charAt(0).toUpperCase()
                                  )}
                                </div>
                                <span className="truncate flex-1">
                                  {m.name || m.email}
                                </span>
                                {assigned && (
                                  <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                                )}
                              </button>
                            );
                          })
                        ) : (
                          <div className="px-2 py-1.5 text-xs text-muted-foreground">
                            No members found
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Reply count + resolved info */}
            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
              <span>{timeAgo(q.createdAt)}</span>
              <span className="text-muted-foreground/40">·</span>
              <button
                className="flex items-center gap-1 hover:text-foreground transition-colors"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                <MessageSquare className="h-3 w-3" />
                <span>
                  {q.replyCount === 0
                    ? "No replies"
                    : `${q.replyCount} repl${q.replyCount === 1 ? "y" : "ies"}`}
                </span>
              </button>
              {isResolved && q.resolvedByName && q.resolvedAt && (
                <span className="text-green-600">
                  Resolved by {q.resolvedByName} {timeAgo(q.resolvedAt)}
                </span>
              )}
            </div>
          </div>

          {/* Priority selector + actions */}
          <div className="flex items-center gap-2 shrink-0">
            {isOpen && (
              <SchemaAttachButton
                questionId={q.id}
                currentIds={q.schemaAssetIds ?? []}
              />
            )}
            <Select
              options={QUESTION_PRIORITIES.map((p) => ({
                value: p,
                label: QUESTION_PRIORITY_LABELS[p],
              }))}
              value={q.priority}
              onChange={(e) => handlePriorityChange(e.target.value)}
              className="w-24"
            />
          </div>
        </div>

        {/* Expanded reply thread */}
        {expanded && (
          <div className="space-y-1">
            {repliesLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                Loading replies...
              </div>
            ) : replies && replies.length > 0 ? (
              <div className="divide-y">
                {replies.map((reply) => (
                  <ReplyBubble key={reply.id} reply={reply} />
                ))}
              </div>
            ) : (
              <div className="py-3 text-center text-xs text-muted-foreground">
                No replies yet
              </div>
            )}

            {/* Actions */}
            {isOpen && (
              <ReplyForm
                questionId={q.id}
                onResolve={handleResolve}
                isResolving={resolveMutation.isPending}
              />
            )}

            {isOpen && (
              <div className="flex justify-end pt-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleDismiss}
                  disabled={updateMutation.isPending}
                  className="text-muted-foreground"
                >
                  Dismiss
                </Button>
              </div>
            )}

            {isResolved && (
              <div className="flex justify-end pt-2 border-t">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleReopen}
                  disabled={reopenMutation.isPending}
                  className="gap-1"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reopen
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
