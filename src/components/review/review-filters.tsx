"use client";

import { Select } from "@/components/ui/select";
import { useReviewStore } from "@/stores/review-store";
import { useReviewQueue } from "@/queries/review-queries";
import {
  MAPPING_STATUS_LABELS,
  type ConfidenceLevel,
  type MappingStatus,
} from "@/lib/constants";

export function ReviewFilters() {
  const {
    confidenceFilter,
    setConfidenceFilter,
    entityFilter,
    setEntityFilter,
    statusFilter,
    setStatusFilter,
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,
  } = useReviewStore();

  // Fetch unfiltered queue to derive available facet values
  const { data: allCards } = useReviewQueue();

  // Derive distinct values from actual data
  const confidenceValues = new Set<ConfidenceLevel>();
  const statusValues = new Set<MappingStatus>();
  const entityMap = new Map<string, string>(); // id → display name

  for (const card of allCards || []) {
    if (card.confidence) confidenceValues.add(card.confidence);
    if (card.status) statusValues.add(card.status);
    if (card.entityId && !entityMap.has(card.entityId)) {
      entityMap.set(card.entityId, card.entityName);
    }
  }

  const confidenceOptions = [
    { value: "all", label: "All Confidence" },
    ...Array.from(confidenceValues)
      .sort((a, b) => {
        const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
        return (order[a] ?? 3) - (order[b] ?? 3);
      })
      .map((c) => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) })),
  ];

  const statusOptions: { value: string; label: string }[] = [
    { value: "all", label: "All Statuses" },
  ];
  for (const s of Array.from(statusValues)) {
    if (MAPPING_STATUS_LABELS[s]) {
      statusOptions.push({ value: s, label: MAPPING_STATUS_LABELS[s] });
    }
  }

  const entityOptions = [
    { value: "all", label: "All Entities" },
    ...Array.from(entityMap.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, name]) => ({ value: id, label: name })),
  ];

  const sortOptions = [
    { value: "confidence", label: "Confidence" },
    { value: "targetFieldName", label: "Field Name" },
    { value: "createdAt", label: "Created" },
  ];

  const orderOptions = [
    { value: "asc", label: "Ascending" },
    { value: "desc", label: "Descending" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        options={confidenceOptions}
        value={confidenceFilter}
        onChange={(e) => setConfidenceFilter(e.target.value as typeof confidenceFilter)}
        className="w-36"
      />
      <Select
        options={statusOptions}
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
        className="w-40"
      />
      <Select
        options={entityOptions}
        value={entityFilter}
        onChange={(e) => setEntityFilter(e.target.value)}
        className="w-48"
      />
      <div className="ml-auto flex items-center gap-2">
        <Select
          options={sortOptions}
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          className="w-32"
        />
        <Select
          options={orderOptions}
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value as typeof sortOrder)}
          className="w-28"
        />
      </div>
    </div>
  );
}
