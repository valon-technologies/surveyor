/**
 * LLM claim extractor: sends text to Claude Sonnet to extract
 * structured mapping claims as HarvestedClaim[].
 */

import Anthropic from "@anthropic-ai/sdk";
import type { HarvestedClaim } from "./types";

const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 4096;

function getClient(): Anthropic {
  return new Anthropic(); // reads ANTHROPIC_API_KEY from env
}

function buildSystemPrompt(entityNames: string[]): string {
  return `You are a data migration analyst extracting structured mapping claims from conversations and documents.

Known VDS target entities:
${entityNames.map((n) => `- ${n}`).join("\n")}

Extract mapping-related claims from the provided text. For each claim, return a JSON object with:
- entity_name: the target entity name from the list above (or null if unclear)
- field_name: the specific target field being discussed (or null if unclear)
- claim_text: a concise, self-contained statement of the mapping claim
- claim_type: one of "mapping_logic", "transformation_rule", "business_rule", "rationale", "question_answer"

Definitions:
- mapping_logic: how a target field is populated from source(s)
- transformation_rule: specific data transformation or expression applied
- business_rule: business constraint or validation rule
- rationale: explanation of why a mapping decision was made
- question_answer: a question and its answer about a mapping

Return a JSON array of claim objects. If no mapping claims are found, return an empty array [].
Do not include any text outside the JSON array.`;
}

interface RawClaim {
  entity_name: string | null;
  field_name: string | null;
  claim_text: string;
  claim_type: string;
}

function parseResponse(text: string): RawClaim[] {
  // Strip markdown code fences if present
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }
  return JSON.parse(cleaned);
}

const VALID_CLAIM_TYPES = new Set([
  "mapping_logic",
  "transformation_rule",
  "business_rule",
  "rationale",
  "question_answer",
]);

/**
 * Extract mapping claims from text using Claude Sonnet.
 */
export async function extractClaims(
  text: string,
  entityNames: string[],
  source: "slack" | "linear" | "google_sheet",
  sourceRef: string,
  milestone: "M1" | "M2" | "M2.5" = "M2",
): Promise<HarvestedClaim[]> {
  const client = getClient();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: buildSystemPrompt(entityNames),
    messages: [
      {
        role: "user",
        content: `Extract mapping claims from the following text:\n\n${text}`,
      },
    ],
  });

  const responseText =
    response.content[0].type === "text" ? response.content[0].text : "";

  let rawClaims: RawClaim[];
  try {
    rawClaims = parseResponse(responseText);
  } catch {
    console.warn(`Failed to parse LLM response for ${sourceRef}: ${responseText.slice(0, 200)}`);
    return [];
  }

  if (!Array.isArray(rawClaims)) return [];

  return rawClaims
    .filter((c) => c.claim_text && typeof c.claim_text === "string")
    .map((c) => ({
      id: crypto.randomUUID(),
      source,
      sourceRef,
      milestone,
      entityName: c.entity_name || null,
      fieldName: c.field_name || null,
      claimText: c.claim_text,
      claimType: VALID_CLAIM_TYPES.has(c.claim_type)
        ? (c.claim_type as HarvestedClaim["claimType"])
        : "mapping_logic",
      anchorStatus: "unanchored" as const,
      anchorDetail: null,
      confidence: 0,
      rawContent: text.slice(0, 2000), // truncate for storage
      createdAt: new Date().toISOString(),
    }));
}
