"use client";

import { useFeedbackEvents, type FeedbackEvent } from "@/queries/feedback-event-queries";
import { cn } from "@/lib/utils";

interface Props {
  entityId: string;
}

/** Group events by correlationId, then by 5-second time windows for uncorrelated events. */
function groupEvents(events: FeedbackEvent[]): FeedbackEvent[][] {
  const groups: FeedbackEvent[][] = [];
  const byCorrelation = new Map<string, FeedbackEvent[]>();
  const uncorrelated: FeedbackEvent[] = [];

  for (const event of events) {
    if (event.correlationId) {
      const group = byCorrelation.get(event.correlationId) ?? [];
      group.push(event);
      byCorrelation.set(event.correlationId, group);
    } else {
      uncorrelated.push(event);
    }
  }

  // Add correlated groups
  for (const group of byCorrelation.values()) {
    groups.push(group.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  }

  // Group uncorrelated by 5-second windows
  let currentGroup: FeedbackEvent[] = [];
  for (const event of uncorrelated) {
    if (
      currentGroup.length === 0 ||
      Math.abs(
        new Date(event.createdAt).getTime() -
          new Date(currentGroup[0].createdAt).getTime()
      ) < 5000
    ) {
      currentGroup.push(event);
    } else {
      groups.push(currentGroup);
      currentGroup = [event];
    }
  }
  if (currentGroup.length > 0) groups.push(currentGroup);

  // Sort groups by earliest event timestamp, descending
  groups.sort((a, b) => b[0].createdAt.localeCompare(a[0].createdAt));

  return groups;
}

const EVENT_LABELS: Record<string, { label: string; color: string }> = {
  verdict_submitted: { label: "Verdict", color: "text-amber-600 bg-amber-50 border-amber-200" },
  learning_created: { label: "Learning Created", color: "text-blue-600 bg-blue-50 border-blue-200" },
  entity_knowledge_rebuilt: { label: "Entity Knowledge Rebuilt", color: "text-purple-600 bg-purple-50 border-purple-200" },
  context_assembled: { label: "Context Assembled", color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  sot_evaluated: { label: "SOT Evaluated", color: "text-rose-600 bg-rose-50 border-rose-200" },
};

function EventCard({ event }: { event: FeedbackEvent }) {
  const meta = EVENT_LABELS[event.eventType] ?? { label: event.eventType, color: "text-gray-600 bg-gray-50 border-gray-200" };
  const time = new Date(event.createdAt).toLocaleTimeString();

  return (
    <div className={cn("border rounded-md px-3 py-2 text-xs", meta.color)}>
      <div className="flex items-center justify-between mb-1">
        <span className="font-semibold">{meta.label}</span>
        <span className="text-[10px] opacity-70">{time}</span>
      </div>
      <EventPayload eventType={event.eventType} payload={event.payload} />
    </div>
  );
}

function EventPayload({ eventType, payload }: { eventType: string; payload: Record<string, unknown> }) {
  switch (eventType) {
    case "verdict_submitted": {
      const p = payload as { fieldName?: string; sourceVerdict?: string; sourceEntity?: string; sourceVerdictNotes?: string; transformVerdict?: string };
      return (
        <div className="space-y-0.5">
          <div>Field: <span className="font-mono">{p.fieldName}</span></div>
          {p.sourceVerdict && <div>Source: <span className="font-semibold">{p.sourceVerdict}</span>{p.sourceEntity ? ` (was: ${p.sourceEntity})` : ""}</div>}
          {p.sourceVerdictNotes && <div className="italic">&quot;{p.sourceVerdictNotes}&quot;</div>}
          {p.transformVerdict && <div>Transform: <span className="font-semibold">{p.transformVerdict}</span></div>}
        </div>
      );
    }
    case "learning_created": {
      const p = payload as { content?: string; fieldName?: string };
      return (
        <div>
          <div className="font-mono">{p.fieldName}</div>
          <div className="mt-0.5 opacity-80 line-clamp-2">{p.content}</div>
        </div>
      );
    }
    case "entity_knowledge_rebuilt": {
      const p = payload as { correctionCount?: number; totalTokens?: number; sectionCount?: number; snippets?: string[] };
      return (
        <div className="space-y-0.5">
          <div>{p.correctionCount} correction{p.correctionCount !== 1 ? "s" : ""}, {p.totalTokens?.toLocaleString()} tokens, {p.sectionCount} section{p.sectionCount !== 1 ? "s" : ""}</div>
          {p.snippets?.map((s, i) => (
            <div key={i} className="opacity-70 line-clamp-1 font-mono text-[10px]">{s}</div>
          ))}
        </div>
      );
    }
    case "context_assembled": {
      const p = payload as { entityKnowledgeIncluded?: boolean; ekTokens?: number; totalContextTokens?: number; skillCount?: number };
      return (
        <div className="space-y-0.5">
          <div>Entity Knowledge: {p.entityKnowledgeIncluded ? `included (${p.ekTokens?.toLocaleString()}t)` : "not found"}</div>
          <div>Total: {p.skillCount} skills, {p.totalContextTokens?.toLocaleString()}t context</div>
        </div>
      );
    }
    case "sot_evaluated": {
      const p = payload as { sourceExactPct?: number; sourceLenientPct?: number; scoredFields?: number; sourceExactCount?: number; deltaFromPrevious?: number | null };
      const delta = p.deltaFromPrevious;
      return (
        <div className="space-y-0.5">
          <div>
            Exact: {p.sourceExactPct}% ({p.sourceExactCount}/{p.scoredFields})
            {delta != null && (
              <span className={cn("ml-1 font-semibold", delta > 0 ? "text-green-700" : delta < 0 ? "text-red-700" : "")}>
                {delta > 0 ? "+" : ""}{delta}%
              </span>
            )}
          </div>
          <div>Lenient: {p.sourceLenientPct}%</div>
        </div>
      );
    }
    default:
      return <pre className="text-[10px] whitespace-pre-wrap">{JSON.stringify(payload, null, 2)}</pre>;
  }
}

export function FeedbackTrail({ entityId }: Props) {
  const { data: events, isLoading } = useFeedbackEvents(entityId);

  if (isLoading) {
    return <div className="animate-pulse h-20 bg-muted rounded-lg" />;
  }

  if (!events || events.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-4 text-center">
        No feedback events yet for this entity. Give a verdict in the discuss view to start the trail.
      </div>
    );
  }

  const groups = groupEvents(events);

  return (
    <div className="space-y-3">
      {groups.map((group, gi) => (
        <div key={gi} className="relative pl-4 border-l-2 border-muted-foreground/20">
          <div className="space-y-1.5">
            {group.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
