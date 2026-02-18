"use client";

import { use } from "react";
import { useSchemaAsset } from "@/queries/schema-queries";
import { SchemaViewer } from "@/components/schemas/schema-viewer";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function SchemaDetailPage({
  params,
}: {
  params: Promise<{ schemaAssetId: string }>;
}) {
  const { schemaAssetId } = use(params);
  const { data: schema, isLoading } = useSchemaAsset(schemaAssetId);

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-48" />
          <div className="h-64 bg-muted rounded" />
        </div>
      </div>
    );
  }

  if (!schema) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Schema not found</p>
        <Link href="/schemas" className="text-sm text-primary hover:underline mt-2 inline-block">
          Back to schemas
        </Link>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/schemas" className="p-1.5 rounded hover:bg-muted transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{schema.name}</h1>
          <p className="text-muted-foreground text-sm">
            {schema.side === "target" ? "ValonOS" : "ServiceMac"} ({schema.side}) &middot; {schema.format} &middot;{" "}
            {schema.entities?.length || 0} entities
          </p>
        </div>
      </div>

      <SchemaViewer schema={schema} />
    </div>
  );
}
