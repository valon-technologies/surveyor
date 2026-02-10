"use client";

import { useState } from "react";
import { QuestionFilters } from "@/components/questions/question-filters";
import { QuestionQueue } from "@/components/questions/question-queue";
import type { WorkspaceTeam, QuestionStatus, QuestionPriority } from "@/lib/constants";

export default function QuestionsPage() {
  const [teamFilter, setTeamFilter] = useState<WorkspaceTeam | "all">("SM");
  const [statusFilter, setStatusFilter] = useState<QuestionStatus | "all">("open");
  const [priorityFilter, setPriorityFilter] = useState<QuestionPriority | "all">("all");

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Questions</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Review and answer questions from punted mappings
        </p>
      </div>

      <QuestionFilters
        teamFilter={teamFilter}
        setTeamFilter={setTeamFilter}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        priorityFilter={priorityFilter}
        setPriorityFilter={setPriorityFilter}
      />

      <QuestionQueue
        teamFilter={teamFilter}
        statusFilter={statusFilter}
        priorityFilter={priorityFilter}
      />
    </div>
  );
}
