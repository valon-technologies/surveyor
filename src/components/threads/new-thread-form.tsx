"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCreateThread } from "@/queries/thread-queries";

interface NewThreadFormProps {
  entityId?: string;
  fieldMappingId?: string;
  onCreated?: () => void;
}

export function NewThreadForm({ entityId, fieldMappingId, onCreated }: NewThreadFormProps) {
  const createThread = useCreateThread();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [createdBy, setCreatedBy] = useState("");

  const handleSubmit = () => {
    if (!body.trim() || !createdBy.trim()) return;
    createThread.mutate(
      {
        entityId,
        fieldMappingId,
        subject: subject || undefined,
        createdBy,
        body,
      },
      {
        onSuccess: () => {
          setSubject("");
          setBody("");
          onCreated?.();
        },
      }
    );
  };

  return (
    <div className="space-y-3 p-4 border rounded-lg">
      <h4 className="text-xs font-semibold">New Thread</h4>
      <Input
        value={createdBy}
        onChange={(e) => setCreatedBy(e.target.value)}
        placeholder="Your name"
        className="text-xs"
      />
      <Input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="Subject (optional)"
        className="text-xs"
      />
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Start the discussion..."
        rows={3}
        className="text-xs"
      />
      <Button
        size="sm"
        onClick={handleSubmit}
        disabled={!body.trim() || !createdBy.trim() || createThread.isPending}
      >
        {createThread.isPending ? "Creating..." : "Start Thread"}
      </Button>
    </div>
  );
}
