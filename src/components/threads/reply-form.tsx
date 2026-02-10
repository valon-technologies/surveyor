"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAddComment } from "@/queries/thread-queries";

interface ReplyFormProps {
  threadId: string;
}

export function ReplyForm({ threadId }: ReplyFormProps) {
  const { data: session } = useSession();
  const addComment = useAddComment();
  const [body, setBody] = useState("");

  const authorName = session?.user?.name || session?.user?.email || "Unknown";

  const handleSubmit = () => {
    if (!body.trim()) return;
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
        disabled={!body.trim() || addComment.isPending}
      >
        {addComment.isPending ? "Sending..." : "Reply"}
      </Button>
    </div>
  );
}
