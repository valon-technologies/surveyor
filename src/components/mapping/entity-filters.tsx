"use client";

import { useMappingStore } from "@/stores/mapping-store";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ENTITY_STATUSES, ENTITY_STATUS_LABELS, PRIORITY_TIERS } from "@/lib/constants";

export function EntityFilters() {
  const {
    entityStatusFilter,
    setEntityStatusFilter,
    tierFilter,
    setTierFilter,
    searchQuery,
    setSearchQuery,
  } = useMappingStore();

  return (
    <div className="flex items-center gap-3">
      <Input
        placeholder="Search entities..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="max-w-xs"
      />
      <Select
        value={entityStatusFilter}
        onChange={(e) => setEntityStatusFilter(e.target.value as typeof entityStatusFilter)}
        options={[
          { value: "all", label: "All Statuses" },
          ...ENTITY_STATUSES.map((s) => ({ value: s, label: ENTITY_STATUS_LABELS[s] })),
        ]}
        className="w-40"
      />
      <Select
        value={tierFilter}
        onChange={(e) => setTierFilter(e.target.value)}
        options={[
          { value: "all", label: "All Tiers" },
          ...PRIORITY_TIERS.map((t) => ({ value: t, label: t })),
        ]}
        className="w-32"
      />
    </div>
  );
}
