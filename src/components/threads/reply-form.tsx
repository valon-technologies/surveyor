"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useAddComment } from "@/queries/thread-queries";

interface ReplyFormProps {
  threadId: string;
}

export function ReplyForm({ threadId }: ReplyFormProps) {
  const addComment = useAddComment();
  const [body, setBody] = useState("");
  const [authorName, setAuthorName] = useState("");

  const handleSubmit = () => {
    if (!body.trim() || !authorName.trim()) return;
    addComment.mutate(
      { threadId, authorName, body },
      {
        onSuccess: () => {
          setBody("");
        },
      }
    );
  };

  return (
    <div className="border-t p-3 space-y-2">
      <Input
        value={authorName}
        onChange={(e) => setAuthorName(e.target.value)}
        placeholder="Your name"
        className="text-xs"
      />
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write a reply..."
        rows={2}
        className="text-xs"
      />
      <Button
        size="sm"
        onClick={handleSubmit}
        disabled={!body.trim() || !authorName.trim() || addComment.isPending}
      >
        {addComment.isPending ? "Sending..." : "Reply"}
      </Button>
    </div>
  );
}
