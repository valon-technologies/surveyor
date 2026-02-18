import type { LLMProvider, CompletionResponse } from "@/lib/llm/provider";
import type { ParsedEntity } from "./schema-parser";

const EXTRACTION_SYSTEM_PROMPT = `You are a schema extraction assistant. You receive a PDF document (a vendor data dictionary or schema specification) and extract structured schema information from it.

Return ONLY valid JSON — no markdown fences, no explanation. The JSON must be an array of entity objects matching this shape:

[
  {
    "name": "TableOrEntityName",
    "displayName": "Human Readable Name",
    "description": "Brief description of the entity/table",
    "fields": [
      {
        "name": "column_name",
        "displayName": "Column Display Name",
        "dataType": "STRING",
        "isRequired": false,
        "isKey": false,
        "description": "Description of the field",
        "sampleValues": ["val1", "val2"],
        "enumValues": ["ALLOWED1", "ALLOWED2"]
      }
    ]
  }
]

Rules:
- Extract ALL tables/entities and their fields from the document
- If only one table is described, return a single-element array
- Normalize data types to: STRING, NUMBER, INTEGER, DECIMAL, DATE, TIMESTAMP, BOOLEAN, ENUM, JSON, ARRAY
- Include descriptions, allowed values, and sample values when available in the document
- If a field has a fixed set of allowed values, put them in enumValues
- If the document mentions primary keys or required fields, set isKey/isRequired accordingly
- Omit optional fields that have no value (don't include null values)`;

export interface PDFSchemaResult {
  entities: ParsedEntity[];
  extractedText: string;
  usage: { inputTokens: number; outputTokens: number };
}

export async function parsePDFSchema(
  base64Content: string,
  fallbackEntityName: string,
  provider: LLMProvider
): Promise<PDFSchemaResult> {
  const response: CompletionResponse = await provider.generateCompletion({
    systemMessage: EXTRACTION_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: base64Content,
            },
          },
          {
            type: "text",
            text: `Extract all entities and fields from this PDF data dictionary. If no explicit table/entity name is found, use "${fallbackEntityName}" as the entity name.`,
          },
        ],
      },
    ],
    model: "claude-haiku-4-5-20251001",
    maxTokens: 8192,
    temperature: 0,
  });

  const raw = response.content.trim();

  // Strip markdown fences if present
  const jsonStr = raw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Failed to parse PDF extraction response as JSON: ${raw.slice(0, 200)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("PDF extraction did not return an array of entities");
  }

  const entities: ParsedEntity[] = parsed.map((e: Record<string, unknown>) => ({
    name: (e.name as string) || fallbackEntityName,
    displayName: e.displayName as string | undefined,
    description: e.description as string | undefined,
    fields: Array.isArray(e.fields)
      ? e.fields.map((f: Record<string, unknown>) => ({
          name: (f.name as string) || "unknown",
          displayName: f.displayName as string | undefined,
          dataType: f.dataType as string | undefined,
          isRequired: f.isRequired as boolean | undefined,
          isKey: f.isKey as boolean | undefined,
          description: f.description as string | undefined,
          sampleValues: f.sampleValues as string[] | undefined,
          enumValues: f.enumValues as string[] | undefined,
        }))
      : [],
  }));

  // Build a readable text summary for rawContent storage
  const extractedText = entities
    .map(
      (e) =>
        `## ${e.name}${e.description ? ` — ${e.description}` : ""}\n` +
        e.fields
          .map(
            (f) =>
              `- ${f.name}${f.dataType ? ` (${f.dataType})` : ""}${f.description ? `: ${f.description}` : ""}`
          )
          .join("\n")
    )
    .join("\n\n");

  return {
    entities,
    extractedText,
    usage: {
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
    },
  };
}
