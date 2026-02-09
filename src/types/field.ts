export interface Field {
  id: string;
  entityId: string;
  name: string;
  displayName: string | null;
  dataType: string | null;
  isRequired: boolean;
  isKey: boolean;
  description: string | null;
  sampleValues: string[] | null;
  enumValues: string[] | null;
  sortOrder: number;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface FieldWithMapping extends Field {
  mapping: {
    id: string;
    status: string;
    sourceEntityId: string | null;
    sourceFieldId: string | null;
    sourceEntityName?: string;
    sourceFieldName?: string;
    transform: string | null;
    defaultValue: string | null;
    confidence: string | null;
    createdBy: string;
  } | null;
}
