"use client";

import { Select } from "@/components/ui/select";
import {
  WORKSPACE_TEAMS,
  WORKSPACE_TEAM_LABELS,
  QUESTION_STATUSES,
  QUESTION_PRIORITIES,
  QUESTION_PRIORITY_LABELS,
} from "@/lib/constants";
import type { WorkspaceTeam, QuestionStatus, QuestionPriority } from "@/lib/constants";

interface QuestionFiltersProps {
  teamFilter: WorkspaceTeam | "all";
  setTeamFilter: (t: WorkspaceTeam | "all") => void;
  statusFilter: QuestionStatus | "all";
  setStatusFilter: (s: QuestionStatus | "all") => void;
  priorityFilter: QuestionPriority | "all";
  setPriorityFilter: (p: QuestionPriority | "all") => void;
}

export function QuestionFilters({
  teamFilter,
  setTeamFilter,
  statusFilter,
  setStatusFilter,
  priorityFilter,
  setPriorityFilter,
}: QuestionFiltersProps) {
  const teamOptions = [
    { value: "all", label: "All Teams" },
    ...WORKSPACE_TEAMS.map((t) => ({ value: t, label: WORKSPACE_TEAM_LABELS[t] })),
  ];

  const statusOptions = [
    { value: "all", label: "All Statuses" },
    ...QUESTION_STATUSES.map((s) => ({
      value: s,
      label: s.charAt(0).toUpperCase() + s.slice(1),
    })),
  ];

  const priorityOptions = [
    { value: "all", label: "All Priorities" },
    ...QUESTION_PRIORITIES.map((p) => ({
      value: p,
      label: QUESTION_PRIORITY_LABELS[p],
    })),
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        options={teamOptions}
        value={teamFilter}
        onChange={(e) => setTeamFilter(e.target.value as typeof teamFilter)}
        className="w-36"
      />
      <Select
        options={statusOptions}
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
        className="w-32"
      />
      <Select
        options={priorityOptions}
        value={priorityFilter}
        onChange={(e) => setPriorityFilter(e.target.value as typeof priorityFilter)}
        className="w-32"
      />
    </div>
  );
}
