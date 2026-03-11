"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { usePuntMapping } from "@/queries/review-queries";
import { useWorkspaceMembers } from "@/queries/member-queries";
import type { ReviewCardData } from "@/types/review";

interface PuntDialogProps {
  card: ReviewCardData;
  onClose: () => void;
}

export function PuntDialog({ card, onClose }: PuntDialogProps) {
  const [note, setNote] = useState("");
  const [assignToSM, setAssignToSM] = useState(false);
  const [questionText, setQuestionText] = useState("");
  const [assigneeId, setAssigneeId] = useState<string>("auto");
  const puntMutation = usePuntMapping();
  const { data: members } = useWorkspaceMembers();

  // Filter to editors/owners only
  const assignableMembers = (members || []).filter(
    (m) => m.role === "editor" || m.role === "owner"
  );

  const handlePunt = async () => {
    if (!note.trim()) return;
    try {
      await puntMutation.mutateAsync({
        mappingId: card.id,
        note: note.trim(),
        assignToSM,
        questionText: assignToSM ? questionText.trim() || undefined : undefined,
        assigneeId: assigneeId !== "auto" ? assigneeId : undefined,
      });
      onClose();
    } catch {
      // Error handled by mutation
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-background rounded-xl shadow-lg w-full max-w-md p-6 space-y-4">
        <h3 className="text-lg font-semibold">Punt Mapping</h3>
        <p className="text-sm text-muted-foreground">
          Delegate <strong>{card.targetFieldName}</strong> ({card.entityName})
          for further review.
        </p>

        <div className="space-y-2">
          <label className="text-sm font-medium">Punt to</label>
          <select
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="auto">Auto-assign (least loaded)</option>
            {assignableMembers.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name || m.email}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Note</label>
          <textarea
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm min-h-[80px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder="Why is this mapping being punted?"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="target"
              checked={!assignToSM}
              onChange={() => setAssignToSM(false)}
              className="accent-primary"
            />
            Keep in VT pool
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="target"
              checked={assignToSM}
              onChange={() => setAssignToSM(true)}
              className="accent-primary"
            />
            Assign to SM (create question)
          </label>
        </div>

        {assignToSM && (
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Question for SM (optional — defaults to punt note)
            </label>
            <textarea
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm min-h-[60px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="What specific question should SM answer?"
              value={questionText}
              onChange={(e) => setQuestionText(e.target.value)}
            />
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handlePunt}
            disabled={!note.trim() || puntMutation.isPending}
          >
            {puntMutation.isPending ? "Punting..." : "Punt"}
          </Button>
        </div>

        {puntMutation.isError && (
          <p className="text-sm text-destructive">
            {puntMutation.error.message}
          </p>
        )}
      </div>
    </div>
  );
}
