"use client";

import { useState } from "react";
import { useThreads } from "@/queries/thread-queries";
import { ThreadDetail } from "./thread-detail";
import { NewThreadForm } from "./new-thread-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MessageSquare, Plus } from "lucide-react";
import { THREAD_STATUS_COLORS, type ThreadStatus } from "@/lib/constants";

interface ThreadListProps {
  entityId?: string;
  fieldMappingId?: string;
  workspaceId: string;
}

export function ThreadList({ entityId, fieldMappingId }: ThreadListProps) {
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  const { data: threads, isLoading } = useThreads({
    entityId,
    fieldMappingId,
  });

  if (selectedThreadId) {
    return (
      <ThreadDetail
        threadId={selectedThreadId}
        onBack={() => setSelectedThreadId(null)}
      />
    );
  }

  return (
    <div className="flex flex-col">
      <div className="p-3 border-b flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          {threads?.length || 0} thread{threads?.length !== 1 ? "s" : ""}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setShowNewForm(!showNewForm)}
          className="h-7 text-xs"
        >
          <Plus className="h-3 w-3 mr-1" />
          New
        </Button>
      </div>

      {showNewForm && (
        <div className="p-3 border-b">
          <NewThreadForm
            entityId={entityId}
            fieldMappingId={fieldMappingId}
            onCreated={() => setShowNewForm(false)}
          />
        </div>
      )}

      {isLoading ? (
        <div className="p-4 text-sm text-muted-foreground">Loading...</div>
      ) : !threads || threads.length === 0 ? (
        <div className="p-6 text-center">
          <MessageSquare className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-xs text-muted-foreground">No threads yet.</p>
          {!showNewForm && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowNewForm(true)}
              className="mt-2 text-xs"
            >
              Start a discussion
            </Button>
          )}
        </div>
      ) : (
        <div className="divide-y">
          {threads.map((thread) => (
            <button
              key={thread.id}
              onClick={() => setSelectedThreadId(thread.id)}
              className="w-full text-left p-3 hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">
                    {thread.subject || "Untitled thread"}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {thread.createdBy} · {thread.commentCount} comment{thread.commentCount !== 1 ? "s" : ""}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className="text-[10px] shrink-0"
                  style={{ borderColor: THREAD_STATUS_COLORS[thread.status as ThreadStatus] }}
                >
                  {thread.status}
                </Badge>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
