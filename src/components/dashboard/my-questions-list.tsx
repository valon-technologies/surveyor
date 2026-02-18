"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  QUESTION_PRIORITY_COLORS,
  QUESTION_PRIORITY_LABELS,
  type QuestionPriority,
} from "@/lib/constants";
import type { MyQuestionItem } from "@/types/dashboard";

export function MyQuestionsList({
  questions,
}: {
  questions: MyQuestionItem[];
}) {
  if (questions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center">
        <p className="text-sm text-muted-foreground">
          No open questions for you right now.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {questions.map((q) => (
        <Link
          key={q.id}
          href="/mapping/questions"
          className="block rounded-lg border p-3 hover:bg-muted/30 transition-colors"
        >
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm line-clamp-2">{q.question}</p>
              <div className="flex items-center gap-2 mt-1.5">
                {q.entityName && (
                  <span className="text-xs text-muted-foreground">
                    {q.entityName}
                    {q.fieldName && ` / ${q.fieldName}`}
                  </span>
                )}
                {q.replyCount > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {q.replyCount} {q.replyCount === 1 ? "reply" : "replies"}
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <PriorityBadge priority={q.priority} />
              <Badge
                variant="outline"
                className="text-[10px] py-0"
              >
                {q.relationship === "assigned"
                  ? "Assigned to you"
                  : "Asked by you"}
              </Badge>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const label =
    QUESTION_PRIORITY_LABELS[priority as QuestionPriority] ?? priority;
  const color =
    QUESTION_PRIORITY_COLORS[priority as QuestionPriority] ?? "#6b7280";

  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-medium"
      style={{ color }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}
