"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDeleteSchemaAsset } from "@/queries/schema-queries";
import { Trash2, Database } from "lucide-react";
import type { SchemaAsset } from "@/types/schema";

interface SchemaListProps {
  schemas: (SchemaAsset & { entityCount: number })[];
}

export function SchemaList({ schemas }: SchemaListProps) {
  const deleteSchema = useDeleteSchemaAsset();

  if (schemas.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Database className="h-8 w-8 mx-auto mb-3 opacity-30" />
        <p>No schemas imported yet.</p>
        <p className="text-sm mt-1">Click "Import Schema" to upload a CSV.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {schemas.map((schema) => (
        <Card key={schema.id}>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Link
                  href={`/schemas/${schema.id}`}
                  className="font-medium text-sm hover:underline"
                >
                  {schema.name}
                </Link>
                <Badge variant="outline">
                  {schema.side}
                </Badge>
                <Badge variant="secondary" className="text-xs">
                  {schema.format}
                </Badge>
              </div>
              {schema.description && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {schema.description}
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                {schema.entityCount} {schema.entityCount === 1 ? "entity" : "entities"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (confirm("Delete this schema and all its entities/fields?")) {
                  deleteSchema.mutate(schema.id);
                }
              }}
            >
              <Trash2 className="h-4 w-4 text-muted-foreground" />
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
