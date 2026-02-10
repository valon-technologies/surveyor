"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDeleteSchemaAsset } from "@/queries/schema-queries";
import { Trash2, Database, Search } from "lucide-react";
import type { SchemaAsset } from "@/types/schema";

interface SchemaListProps {
  schemas: (SchemaAsset & { entityCount: number })[];
}

export function SchemaList({ schemas }: SchemaListProps) {
  const deleteSchema = useDeleteSchemaAsset();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return schemas;
    const q = query.toLowerCase();
    return schemas.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q) ||
        s.side.toLowerCase().includes(q) ||
        s.format.toLowerCase().includes(q)
    );
  }, [schemas, query]);

  if (schemas.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Database className="h-8 w-8 mx-auto mb-3 opacity-30" />
        <p>No schemas imported yet.</p>
        <p className="text-sm mt-1">Click &quot;Import Schema&quot; to upload a CSV.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search schemas by name, description, side, or format..."
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          No schemas match &ldquo;{query}&rdquo;
        </p>
      ) : (
        <div className="space-y-3">
          {filtered.map((schema) => (
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
      )}
    </div>
  );
}
