"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldList } from "./field-list";
import { useEntity } from "@/queries/entity-queries";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { SchemaAssetWithEntities } from "@/types/schema";

export function SchemaViewer({ schema }: { schema: SchemaAssetWithEntities }) {
  const [expandedEntity, setExpandedEntity] = useState<string | null>(null);

  if (!schema.entities || schema.entities.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No entities found in this schema.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {schema.entities.map((entity) => (
        <Card key={entity.id}>
          <button
            onClick={() =>
              setExpandedEntity(expandedEntity === entity.id ? null : entity.id)
            }
            className="w-full text-left"
          >
            <CardHeader className="py-3 px-4">
              <div className="flex items-center gap-2">
                {expandedEntity === entity.id ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
                <CardTitle className="text-sm">
                  {entity.displayName || entity.name}
                </CardTitle>
                <span className="text-xs text-muted-foreground">
                  {entity.fieldCount} fields
                </span>
              </div>
            </CardHeader>
          </button>
          {expandedEntity === entity.id && (
            <CardContent className="pt-0 px-4 pb-4">
              <ExpandedEntityFields entityId={entity.id} />
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  );
}

function ExpandedEntityFields({ entityId }: { entityId: string }) {
  const { data: entity, isLoading } = useEntity(entityId);

  if (isLoading) {
    return <div className="text-xs text-muted-foreground py-2">Loading fields...</div>;
  }

  if (!entity?.fields) {
    return <div className="text-xs text-muted-foreground py-2">No fields found.</div>;
  }

  return <FieldList fields={entity.fields} />;
}
