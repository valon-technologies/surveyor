import type { LLMProvider, CompletionResponse } from "@/lib/llm/provider";

const EXTRACTION_SYSTEM_PROMPT = `You are a document analysis assistant. You receive a PDF document (typically a data dictionary, code breaker, lookup table, or schema specification) and produce a well-organized markdown reference.

Structure your output as follows:

1. **Summary** (2-3 sentences) — What this document is, what system/domain it covers, and what kind of information it contains.

2. **Key Information** — A bulleted list of the most important takeaways: critical codes, categories, statuses, or mappings that someone would need to reference frequently.

3. **Full Reference** — The complete document content organized under clear headings. Format tables as markdown tables. Preserve all codes, values, enumerations, and lookup mappings exactly as they appear. Use headings (##, ###) to maintain document structure.

Rules:
- Do NOT omit any codes, values, or mappings from the Full Reference section
- Format tables as markdown tables with aligned columns
- Keep code values and enumerations exactly as they appear in the source
- Group related information logically even if the source document is unstructured`;

export interface PDFTextResult {
  content: string;
  usage: { inputTokens: number; outputTokens: number };
}

export async function extractPDFText(
  base64Content: string,
  fileName: string,
  provider: LLMProvider
): Promise<PDFTextResult> {
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
            text: `Analyze this PDF document ("${fileName}") and produce a well-organized markdown reference with a summary, key information, and full reference sections.`,
          },
        ],
      },
    ],
    model: "claude-haiku-4-5-20251001",
    maxTokens: 8192,
    temperature: 0,
  });

  return {
    content: response.content,
    usage: {
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
    },
  };
}
