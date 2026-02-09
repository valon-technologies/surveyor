"use client";

import { use } from "react";
import { useContext } from "@/queries/context-queries";
import { ContextEditor } from "@/components/context/context-editor";

export default function ContextDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: context, isLoading } = useContext(id);

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-muted rounded" />
          <div className="h-64 bg-muted rounded" />
        </div>
      </div>
    );
  }

  if (!context) {
    return (
      <div className="p-8">
        <p className="text-sm text-muted-foreground">Context not found.</p>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Edit Context</h1>
        <p className="text-muted-foreground text-sm mt-1">{context.name}</p>
      </div>

      <ContextEditor context={context} />
    </div>
  );
}
