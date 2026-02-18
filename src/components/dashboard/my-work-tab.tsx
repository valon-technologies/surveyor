"use client";

import { useMyWork } from "@/queries/dashboard-queries";
import { AssignedFieldsList } from "./assigned-fields-list";
import { MyQuestionsList } from "./my-questions-list";

export function MyWorkTab() {
  const { data, isLoading } = useMyWork();

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-5 bg-muted rounded w-40" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 bg-muted rounded-md" />
          ))}
        </div>
        <div className="h-5 bg-muted rounded w-40" />
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-16 bg-muted rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">
            Assigned Fields
          </h2>
          <span className="text-xs text-muted-foreground tabular-nums">
            {data.assignedFields.length} total
          </span>
        </div>
        <AssignedFieldsList fields={data.assignedFields} />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">
            My Questions
          </h2>
          <span className="text-xs text-muted-foreground tabular-nums">
            {data.myQuestions.length} open
          </span>
        </div>
        <MyQuestionsList questions={data.myQuestions} />
      </section>
    </div>
  );
}
