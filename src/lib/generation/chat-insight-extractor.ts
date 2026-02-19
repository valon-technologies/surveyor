/**
 * Chat Insight Extractor — extracts actionable insights from chat sessions.
 *
 * After a substantive chat discussion (>3 messages), this module:
 * 1. Loads the conversation transcript
 * 2. Runs a single LLM call to extract insights
 * 3. Emits chat_insight signals for each actionable insight
 *
 * Can be run as a deferred/background job after session completion.
 */

import { db } from "@/lib/db";
import { chatSession, chatMessage, entity } from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import type { LLMProvider } from "@/lib/llm/provider";
import { emitSignal } from "./skill-signals";

const MIN_MESSAGES_FOR_EXTRACTION = 3;

interface ExtractedInsight {
  category: "mapping_pattern" | "data_quality" | "business_rule" | "context_gap" | "disambiguation";
  summary: string;
  fieldName?: string;
  confidence: "high" | "medium";
}

interface ExtractionResult {
  insights: ExtractedInsight[];
  signalsEmitted: number;
  sessionId: string;
}

/**
 * Extract insights from a chat session's conversation.
 * Only processes sessions with enough messages to be substantive.
 */
export async function extractChatInsights(
  provider: LLMProvider,
  workspaceId: string,
  sessionId: string,
): Promise<ExtractionResult> {
  // Load session
  const session = db
    .select()
    .from(chatSession)
    .where(eq(chatSession.id, sessionId))
    .get();

  if (!session) {
    throw new Error(`Chat session ${sessionId} not found`);
  }

  // Load messages
  const messages = db
    .select({
      role: chatMessage.role,
      content: chatMessage.content,
      createdAt: chatMessage.createdAt,
    })
    .from(chatMessage)
    .where(eq(chatMessage.sessionId, sessionId))
    .orderBy(asc(chatMessage.createdAt))
    .all();

  // Skip sessions that are too short
  const nonSystemMessages = messages.filter((m) => m.role !== "system");
  if (nonSystemMessages.length < MIN_MESSAGES_FOR_EXTRACTION) {
    return { insights: [], signalsEmitted: 0, sessionId };
  }

  // Resolve entity name for signal context
  let entityName: string | null = null;
  if (session.entityId) {
    const ent = db
      .select({
        name: entity.name,
        displayName: entity.displayName,
      })
      .from(entity)
      .where(eq(entity.id, session.entityId))
      .get();
    entityName = ent?.displayName || ent?.name || null;
  }

  // Build transcript for LLM
  const transcript = nonSystemMessages
    .map((m) => `[${m.role.toUpperCase()}]: ${m.content}`)
    .join("\n\n");

  // Truncate to ~8K tokens worth (~32K chars)
  const truncatedTranscript =
    transcript.length > 32000
      ? transcript.slice(0, 32000) + "\n\n[... truncated]"
      : transcript;

  // Call LLM to extract insights
  const insights = await callLLMForInsights(
    provider,
    truncatedTranscript,
    entityName,
  );

  // Emit signals for high-confidence insights
  let signalsEmitted = 0;
  for (const insight of insights) {
    if (insight.confidence !== "high") continue;

    try {
      emitSignal({
        workspaceId,
        entityId: session.entityId || undefined,
        signalType: "chat_insight",
        summary: `[${insight.category}] ${insight.summary}`,
        sourceId: sessionId,
        sourceType: "chat_session",
      });
      signalsEmitted++;
    } catch {
      // Non-critical
    }
  }

  return { insights, signalsEmitted, sessionId };
}

async function callLLMForInsights(
  provider: LLMProvider,
  transcript: string,
  entityName: string | null,
): Promise<ExtractedInsight[]> {
  const systemMessage = `You are an insight extractor for a data mapping platform. Given a chat transcript between a user and an AI mapping assistant, extract actionable insights that could improve future mapping quality.

## Insight Categories
- **mapping_pattern**: A confirmed pattern (e.g., "field X always maps from table Y")
- **data_quality**: A data quality issue discovered (e.g., "column Z is often null, use fallback")
- **business_rule**: A business rule clarified in discussion (e.g., "inactive loans use different logic")
- **context_gap**: Missing documentation identified (e.g., "no enum definition for indicator values")
- **disambiguation**: Clarification of confusing names/concepts (e.g., "original_upb vs current_upb")

## Rules
- Only extract insights with clear, actionable information
- Skip generic discussion, greetings, and repetition
- Each insight should be a standalone statement useful for future mapping
- Mark confidence as "high" only if the insight is clearly confirmed in the conversation
- Mark as "medium" if it's implied but not explicitly confirmed
- Include fieldName when the insight is specific to a particular field

## Output Format
Return a JSON array of insights:
\`\`\`json
[
  {
    "category": "mapping_pattern",
    "summary": "Concise actionable statement",
    "fieldName": "optional_field_name",
    "confidence": "high"
  }
]
\`\`\`

If no actionable insights exist, return an empty array: \`[]\``;

  const userMessage = entityName
    ? `Extract insights from this mapping discussion about "${entityName}":\n\n${transcript}`
    : `Extract insights from this mapping discussion:\n\n${transcript}`;

  try {
    const response = await provider.generateCompletion({
      systemMessage,
      userMessage,
      temperature: 0.2,
      maxTokens: 2048,
    });

    return parseInsights(response.content);
  } catch (err) {
    console.warn("[chat-insight-extractor] LLM call failed:", err);
    return [];
  }
}

function parseInsights(text: string): ExtractedInsight[] {
  // Try to extract JSON array from response
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (item: any) =>
          item &&
          typeof item.category === "string" &&
          typeof item.summary === "string" &&
          ["mapping_pattern", "data_quality", "business_rule", "context_gap", "disambiguation"].includes(
            item.category,
          ),
      )
      .map((item: any) => ({
        category: item.category,
        summary: String(item.summary).slice(0, 500),
        fieldName: item.fieldName ? String(item.fieldName) : undefined,
        confidence: item.confidence === "high" ? "high" : "medium",
      }));
  } catch {
    return [];
  }
}
