"use client";

import { useThread, useUpdateThread } from "@/queries/thread-queries";
import { CommentBubble } from "./comment-bubble";
import { ReplyForm } from "./reply-form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, CheckCircle } from "lucide-react";
import { THREAD_STATUS_COLORS, type ThreadStatus } from "@/lib/constants";

interface ThreadDetailProps {
  threadId: string;
  onBack: () => void;
}

export function ThreadDetail({ threadId, onBack }: ThreadDetailProps) {
  const { data: thread, isLoading } = useThread(threadId);
  const updateThread = useUpdateThread();

  if (isLoading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading thread...</div>;
  }

  if (!thread) {
    return <div className="p-4 text-sm text-muted-foreground">Thread not found.</div>;
  }

  const handleResolve = () => {
    updateThread.mutate({
      threadId,
      status: thread.status === "resolved" ? "open" : "resolved",
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b space-y-2">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="p-1 rounded hover:bg-muted">
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <span className="text-xs font-medium truncate flex-1">
            {thread.subject || "Thread"}
          </span>
          <Badge
            variant="outline"
            className="text-[10px]"
            style={{ borderColor: THREAD_STATUS_COLORS[thread.status as ThreadStatus] }}
          >
            {thread.status}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={thread.status === "resolved" ? "outline" : "default"}
            onClick={handleResolve}
            disabled={updateThread.isPending}
            className="text-xs h-7"
          >
            <CheckCircle className="h-3 w-3 mr-1" />
            {thread.status === "resolved" ? "Reopen" : "Resolve"}
          </Button>
        </div>
      </div>

      {/* Comments */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {thread.comments.map((c) => (
          <CommentBubble key={c.id} comment={c} />
        ))}
      </div>

      {/* Reply */}
      {thread.status !== "archived" && <ReplyForm threadId={threadId} />}
    </div>
  );
}
