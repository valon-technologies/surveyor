import type { SchemaSide, SchemaFormat } from "@/lib/constants";

export interface SchemaAsset {
  id: string;
  workspaceId: string;
  name: string;
  side: SchemaSide;
  description: string | null;
  sourceFile: string | null;
  format: SchemaFormat;
  rawContent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface SchemaAssetWithEntities extends SchemaAsset {
  entities: Array<{
    id: string;
    name: string;
    displayName: string | null;
    fieldCount: number;
  }>;
}

export interface SchemaAssetCreateInput {
  name: string;
  side: SchemaSide;
  description?: string;
  sourceFile?: string;
  format?: SchemaFormat;
  rawContent: string;
}
