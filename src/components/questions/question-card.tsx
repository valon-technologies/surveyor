"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { useUpdateQuestion } from "@/queries/question-queries";
import {
  QUESTION_PRIORITY_LABELS,
  QUESTION_PRIORITY_COLORS,
  QUESTION_PRIORITIES,
} from "@/lib/constants";
import type { Question } from "@/types/question";
import type { QuestionPriority } from "@/lib/constants";

interface QuestionCardProps {
  question: Question;
}

export function QuestionCard({ question: q }: QuestionCardProps) {
  const [answer, setAnswer] = useState(q.answer || "");
  const updateMutation = useUpdateQuestion();

  const priorityColor = q.priority
    ? QUESTION_PRIORITY_COLORS[q.priority as QuestionPriority]
    : "#6b7280";

  const handleAnswer = () => {
    if (!answer.trim()) return;
    updateMutation.mutate({
      id: q.id,
      answer: answer.trim(),
      status: "answered",
      answeredBy: "user",
    });
  };

  const handlePriorityChange = (priority: string) => {
    updateMutation.mutate({ id: q.id, priority });
  };

  const handleDismiss = () => {
    updateMutation.mutate({ id: q.id, status: "dismissed" });
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Badge
                variant="outline"
                className="text-[10px] shrink-0"
                style={{ borderColor: priorityColor, color: priorityColor }}
              >
                {QUESTION_PRIORITY_LABELS[q.priority as QuestionPriority] || q.priority}
              </Badge>
              {q.targetForTeam && (
                <Badge variant="secondary" className="text-[10px]">
                  {q.targetForTeam}
                </Badge>
              )}
              <Badge
                variant={q.status === "answered" ? "default" : "outline"}
                className="text-[10px]"
              >
                {q.status}
              </Badge>
            </div>
            <p className="text-sm font-medium">{q.question}</p>
          </div>

          <Select
            options={QUESTION_PRIORITIES.map((p) => ({
              value: p,
              label: QUESTION_PRIORITY_LABELS[p],
            }))}
            value={q.priority}
            onChange={(e) => handlePriorityChange(e.target.value)}
            className="w-24 shrink-0"
          />
        </div>

        {q.status === "answered" && q.answer ? (
          <div className="bg-muted rounded-lg px-3 py-2">
            <span className="text-xs text-muted-foreground block mb-1">
              Answer:
            </span>
            <p className="text-sm">{q.answer}</p>
          </div>
        ) : (
          <div className="space-y-2">
            <textarea
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm min-h-[60px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="Type an answer..."
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={handleDismiss}
                disabled={updateMutation.isPending}
              >
                Dismiss
              </Button>
              <Button
                size="sm"
                onClick={handleAnswer}
                disabled={!answer.trim() || updateMutation.isPending}
              >
                Answer
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
