"use client";

import { useState } from "react";
import { useSchemaAssets } from "@/queries/schema-queries";
import { SchemaList } from "@/components/schemas/schema-list";
import { SchemaImportDialog } from "@/components/schemas/schema-import-dialog";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function SchemasPage() {
  const { data: schemas, isLoading } = useSchemaAssets();
  const [importOpen, setImportOpen] = useState(false);

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Schemas</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Import and browse schema assets
          </p>
        </div>
        <Button onClick={() => setImportOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          Import Schema
        </Button>
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-16 bg-muted rounded" />
          ))}
        </div>
      ) : (
        <SchemaList schemas={schemas || []} />
      )}

      <SchemaImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
      />
    </div>
  );
}
