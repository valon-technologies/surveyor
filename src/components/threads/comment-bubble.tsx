"use client";

import type { Comment } from "@/types/thread";

interface CommentBubbleProps {
  comment: Comment;
}

export function CommentBubble({ comment }: CommentBubbleProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-semibold text-primary">
          {comment.authorName.charAt(0).toUpperCase()}
        </div>
        <span className="text-xs font-medium">{comment.authorName}</span>
        <span className="text-[10px] text-muted-foreground">
          {new Date(comment.createdAt).toLocaleString()}
        </span>
        {comment.editedAt && (
          <span className="text-[10px] text-muted-foreground italic">(edited)</span>
        )}
      </div>
      <div className="ml-8 text-sm text-foreground whitespace-pre-wrap">
        {comment.body}
      </div>
    </div>
  );
}
