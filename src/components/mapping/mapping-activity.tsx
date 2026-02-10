"use client";

import {
  MessageSquare,
  Save,
  CheckCircle,
  RotateCcw,
  ArrowRightLeft,
  FlaskConical,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { useFieldActivity, type ActivityEntry } from "@/queries/mapping-queries";
import { MappingStatusBadge } from "@/components/shared/status-badge";

const ACTION_CONFIG: Record<string, { icon: LucideIcon; label: string; color: string }> = {
  mapping_saved: { icon: Save, label: "Mapping saved", color: "text-blue-500" },
  status_change: { icon: ArrowRightLeft, label: "Status changed", color: "text-amber-500" },
  comment_added: { icon: MessageSquare, label: "Comment added", color: "text-purple-500" },
  thread_created: { icon: Plus, label: "Thread created", color: "text-purple-500" },
  thread_resolved: { icon: CheckCircle, label: "Thread resolved", color: "text-green-500" },
  case_closed: { icon: CheckCircle, label: "Case closed", color: "text-green-600" },
  case_reopened: { icon: RotateCcw, label: "Case re-opened", color: "text-amber-600" },
  validation_ran: { icon: FlaskConical, label: "Validation ran", color: "text-cyan-500" },
};

function ActivityItem({ entry }: { entry: ActivityEntry }) {
  const config = ACTION_CONFIG[entry.action] || {
    icon: ArrowRightLeft,
    label: entry.action,
    color: "text-muted-foreground",
  };
  const Icon = config.icon;
  const detail = entry.detail as Record<string, string> | null;

  return (
    <div className="relative pl-8">
      <div className={`absolute left-1.5 top-2 h-3 w-3 rounded-full border-2 border-background ${config.color} bg-current`} />
      <div className="border rounded-lg p-3 space-y-1">
        <div className="flex items-center gap-2">
          <Icon className={`h-3.5 w-3.5 ${config.color}`} />
          <span className="text-xs font-medium">{config.label}</span>
        </div>

        {detail?.changeSummary && (
          <p className="text-xs text-muted-foreground">{detail.changeSummary}</p>
        )}
        {detail?.subject && (
          <p className="text-xs text-muted-foreground">&ldquo;{detail.subject}&rdquo;</p>
        )}
        {detail?.from && detail?.to && (
          <div className="flex items-center gap-1.5 text-xs">
            <MappingStatusBadge status={detail.from} />
            <span className="text-muted-foreground">&rarr;</span>
            <MappingStatusBadge status={detail.to} />
          </div>
        )}
        {detail?.validationStatus && (
          <p className={`text-xs font-medium ${detail.validationStatus === "passed" ? "text-green-600" : "text-red-600"}`}>
            {detail.validationStatus === "passed" ? "Passed" : `Failed${detail.errorMessage ? `: ${detail.errorMessage}` : ""}`}
          </p>
        )}

        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{entry.actorName}</span>
          <span>{new Date(entry.createdAt).toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

interface MappingActivityProps {
  mappingId: string | undefined;
}

export function MappingActivity({ mappingId }: MappingActivityProps) {
  const { data: activities, isLoading } = useFieldActivity(mappingId);

  if (!mappingId) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Save a mapping to see activity.
      </div>
    );
  }

  if (isLoading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading activity...</div>;
  }

  if (!activities || activities.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">No activity yet.</div>;
  }

  return (
    <div className="p-4">
      <div className="relative">
        <div className="absolute left-3 top-2 bottom-2 w-px bg-border" />
        <div className="space-y-3">
          {activities.map((entry) => (
            <ActivityItem key={entry.id} entry={entry} />
          ))}
        </div>
      </div>
    </div>
  );
}
