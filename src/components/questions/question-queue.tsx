"use client";

import { useQuestions } from "@/queries/question-queries";
import { QuestionCard } from "./question-card";
import type { QuestionStatus, QuestionPriority, WorkspaceTeam } from "@/lib/constants";

interface QuestionQueueProps {
  teamFilter: WorkspaceTeam | "all";
  statusFilter: QuestionStatus | "all";
  priorityFilter: QuestionPriority | "all";
}

export function QuestionQueue({
  teamFilter,
  statusFilter,
  priorityFilter,
}: QuestionQueueProps) {
  const filters: Record<string, string> = {};
  if (statusFilter !== "all") filters.status = statusFilter;
  if (teamFilter !== "all") filters.targetForTeam = teamFilter;

  const { data: questions, isLoading } = useQuestions(filters);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  // Client-side priority filter
  let filtered = questions || [];
  if (priorityFilter !== "all") {
    filtered = filtered.filter((q) => q.priority === priorityFilter);
  }

  // Sort: urgent first, then by creation
  const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
  filtered.sort((a, b) => {
    const pa = priorityOrder[a.priority as keyof typeof priorityOrder] ?? 2;
    const pb = priorityOrder[b.priority as keyof typeof priorityOrder] ?? 2;
    if (pa !== pb) return pa - pb;
    return a.createdAt.localeCompare(b.createdAt);
  });

  if (!filtered.length) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-sm">No questions found</p>
        <p className="text-xs mt-1">
          Questions created from punted mappings will appear here
        </p>
      </div>
    );
  }

  const openCount = filtered.filter((q) => q.status === "open").length;

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        {filtered.length} questions
        {openCount > 0 && (
          <span className="text-blue-600 ml-2">{openCount} open</span>
        )}
      </div>
      {filtered.map((q) => (
        <QuestionCard key={q.id} question={q} />
      ))}
    </div>
  );
}
