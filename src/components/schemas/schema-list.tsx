"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDeleteSchemaAsset } from "@/queries/schema-queries";
import { Trash2, Database, Search, ArrowRight } from "lucide-react";
import type { SchemaAsset } from "@/types/schema";

const SIDE_LABELS: Record<string, { name: string; label: string }> = {
  source: { name: "ServiceMac", label: "Source" },
  target: { name: "ValonOS", label: "Target" },
};

interface SchemaListProps {
  schemas: (SchemaAsset & { entityCount: number })[];
}

function SchemaCard({
  schema,
  onDelete,
}: {
  schema: SchemaAsset & { entityCount: number };
  onDelete: (id: string) => void;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Link
              href={`/schemas/${schema.id}`}
              className="font-medium text-sm hover:underline"
            >
              {schema.name}
            </Link>
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
              onDelete(schema.id);
            }
          }}
        >
          <Trash2 className="h-4 w-4 text-muted-foreground" />
        </Button>
      </CardContent>
    </Card>
  );
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

  const grouped = useMemo(() => {
    const source = filtered.filter((s) => s.side === "source");
    const target = filtered.filter((s) => s.side === "target");
    return { source, target };
  }, [filtered]);

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
    <div className="space-y-6">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search schemas by name, description, or format..."
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          No schemas match &ldquo;{query}&rdquo;
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-4 items-start">
          {/* Source: ServiceMac */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-sm font-semibold">
                {SIDE_LABELS.source.name}
              </h2>
              <Badge variant="outline" className="text-xs">
                {SIDE_LABELS.source.label}
              </Badge>
              <span className="text-xs text-muted-foreground ml-auto">
                {grouped.source.length} {grouped.source.length === 1 ? "schema" : "schemas"}
              </span>
            </div>
            {grouped.source.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                No source schemas{query ? " match your search" : " imported yet"}
              </p>
            ) : (
              <div className="space-y-2">
                {grouped.source.map((schema) => (
                  <SchemaCard
                    key={schema.id}
                    schema={schema}
                    onDelete={(id) => deleteSchema.mutate(id)}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Arrow */}
          <div className="hidden lg:flex items-center pt-10">
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
          </div>

          {/* Target: ValonOS */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-sm font-semibold">
                {SIDE_LABELS.target.name}
              </h2>
              <Badge variant="outline" className="text-xs">
                {SIDE_LABELS.target.label}
              </Badge>
              <span className="text-xs text-muted-foreground ml-auto">
                {grouped.target.length} {grouped.target.length === 1 ? "schema" : "schemas"}
              </span>
            </div>
            {grouped.target.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                No target schemas{query ? " match your search" : " imported yet"}
              </p>
            ) : (
              <div className="space-y-2">
                {grouped.target.map((schema) => (
                  <SchemaCard
                    key={schema.id}
                    schema={schema}
                    onDelete={(id) => deleteSchema.mutate(id)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
