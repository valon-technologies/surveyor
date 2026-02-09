"use client";

import { useEntities } from "@/queries/entity-queries";
import { useMappingStore } from "@/stores/mapping-store";
import { EntityFilters } from "@/components/mapping/entity-filters";
import { EntityList } from "@/components/mapping/entity-list";

export default function MappingPage() {
  const { entityStatusFilter, tierFilter, searchQuery } = useMappingStore();
  const { data: entities, isLoading } = useEntities({
    side: "target",
    status: entityStatusFilter === "all" ? undefined : entityStatusFilter,
    tier: tierFilter === "all" ? undefined : tierFilter,
    search: searchQuery || undefined,
  });

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Mapping</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Browse target entities and map their fields
        </p>
      </div>

      <EntityFilters />

      {isLoading ? (
        <div className="animate-pulse space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-muted rounded" />
          ))}
        </div>
      ) : (
        <EntityList entities={entities || []} />
      )}
    </div>
  );
}
