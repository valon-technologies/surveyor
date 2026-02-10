"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useGenerationPoll } from "@/queries/generation-queries";
import { useGenerationQueueStore } from "@/stores/generation-queue-store";
import { useMappingStore } from "@/stores/mapping-store";
import { useToast } from "@/components/ui/toast";
import type { ParseResult } from "@/types/generation";

function SinglePoller({ generationId }: { generationId: string }) {
  const { data } = useGenerationPoll(generationId);
  const updateGeneration = useGenerationQueueStore((s) => s.updateGeneration);
  const queue = useGenerationQueueStore((s) => s.queue);
  const { addToast } = useToast();
  const qc = useQueryClient();
  const router = useRouter();
  const setAutoMapSheetOpen = useMappingStore((s) => s.setAutoMapSheetOpen);
  const setReviewGenerationId = useMappingStore((s) => s.setReviewGenerationId);
  const notifiedRef = useRef(false);

  const queueItem = queue.find((g) => g.generationId === generationId);

  useEffect(() => {
    if (!data || notifiedRef.current) return;
    if (data.status !== "completed" && data.status !== "failed") return;

    notifiedRef.current = true;

    if (data.status === "completed") {
      updateGeneration(generationId, {
        status: "completed",
        completedAt: Date.now(),
        parsedOutput: data.outputParsed as unknown as ParseResult | undefined,
      });

      const fieldCount =
        (data.outputParsed as unknown as ParseResult)?.fieldMappings?.length ?? 0;
      const entityId = queueItem?.entityId;

      addToast({
        type: "success",
        title: `Auto-Map complete for ${queueItem?.entityName ?? "entity"}`,
        description: `${fieldCount} suggestion${fieldCount !== 1 ? "s" : ""} ready for review`,
        action: entityId
          ? {
              label: "Review",
              onClick: () => {
                setReviewGenerationId(generationId);
                setAutoMapSheetOpen(true);
                router.push(`/mapping/${entityId}`);
              },
            }
          : undefined,
      });

      // Invalidate relevant queries so data is fresh
      qc.invalidateQueries({ queryKey: ["entities"] });
      qc.invalidateQueries({ queryKey: ["mappings"] });
      qc.invalidateQueries({ queryKey: ["generations"] });
      if (queueItem?.entityId) {
        qc.invalidateQueries({ queryKey: ["entity", queueItem.entityId] });
      }
    } else {
      updateGeneration(generationId, {
        status: "failed",
        completedAt: Date.now(),
        error: data.error || "Generation failed",
      });

      addToast({
        type: "error",
        title: `Auto-Map failed for ${queueItem?.entityName ?? "entity"}`,
        description: data.error || "An unknown error occurred",
      });

      qc.invalidateQueries({ queryKey: ["generations"] });
    }
  }, [data, generationId, updateGeneration, addToast, qc, queueItem, notifiedRef]);

  return null;
}

export function GenerationPoller() {
  const queue = useGenerationQueueStore((s) => s.queue);
  const runningJobs = queue.filter((g) => g.status === "running");

  return (
    <>
      {runningJobs.map((job) => (
        <SinglePoller key={job.generationId} generationId={job.generationId} />
      ))}
    </>
  );
}
