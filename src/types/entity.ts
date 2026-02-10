import type { EntityStatus, SchemaSide } from "@/lib/constants";

export interface Entity {
  id: string;
  workspaceId: string;
  schemaAssetId: string;
  name: string;
  displayName: string | null;
  side: SchemaSide;
  description: string | null;
  status: EntityStatus;
  sortOrder: number;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface EntityWithFields extends Entity {
  fields: Array<{
    id: string;
    name: string;
    displayName: string | null;
    dataType: string | null;
    isRequired: boolean;
    isKey: boolean;
    description: string | null;
  }>;
}

export interface EntityWithStats extends Entity {
  fieldCount: number;
  mappedCount: number;
  unmappedCount: number;
  coveragePercent: number;
  openQuestions: number;
  statusBreakdown: Record<string, number>;
}
