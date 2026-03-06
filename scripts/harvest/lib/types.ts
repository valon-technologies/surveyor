export interface HarvestedClaim {
  id: string;
  source: "slack" | "linear" | "google_sheet";
  sourceRef: string;
  milestone: "M1" | "M2" | "M2.5";
  entityName: string | null;
  fieldName: string | null;
  claimText: string;
  claimType: "mapping_logic" | "transformation_rule" | "business_rule" | "rationale" | "question_answer";
  anchorStatus: "agrees" | "contradicts" | "related" | "unanchored";
  anchorDetail: string | null;
  confidence: number;
  rawContent: string;
  createdAt: string;
}

export interface SotMapping {
  entity: string;
  field: string;
  sources: { name: string; alias: string; staging: string }[];
  transform: string;
  dtype: string;
  sourceColumn: string | null;
}

export interface ExtractionWindow {
  messages: { author: string; text: string; ts: string }[];
  source: string;
  sourceRef: string;
}
