"use client";

import { Select } from "@/components/ui/select";
import { useReviewStore } from "@/stores/review-store";
import { useEntities } from "@/queries/entity-queries";
import {
  CONFIDENCE_LEVELS,
  REVIEW_STATUSES,
  REVIEW_STATUS_LABELS,
} from "@/lib/constants";

export function ReviewFilters() {
  const {
    confidenceFilter,
    setConfidenceFilter,
    entityFilter,
    setEntityFilter,
    reviewStatusFilter,
    setReviewStatusFilter,
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,
  } = useReviewStore();

  const { data: entities } = useEntities({ side: "target" });

  const confidenceOptions = [
    { value: "all", label: "All Confidence" },
    ...CONFIDENCE_LEVELS.map((c) => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) })),
  ];

  const statusOptions = [
    { value: "all", label: "All Statuses" },
    ...REVIEW_STATUSES.map((s) => ({ value: s, label: REVIEW_STATUS_LABELS[s] })),
  ];

  const entityOptions = [
    { value: "all", label: "All Entities" },
    ...(entities || []).map((e) => ({
      value: e.id,
      label: e.displayName || e.name,
    })),
  ];

  const sortOptions = [
    { value: "confidence", label: "Confidence" },
    { value: "entityName", label: "Entity" },
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
        value={reviewStatusFilter}
        onChange={(e) => setReviewStatusFilter(e.target.value as typeof reviewStatusFilter)}
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
