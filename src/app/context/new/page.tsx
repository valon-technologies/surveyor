"use client";

import { ContextEditor } from "@/components/context/context-editor";

export default function NewContextPage() {
  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New Context</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Create a new context document
        </p>
      </div>

      <ContextEditor />
    </div>
  );
}
