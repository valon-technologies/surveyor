import { encodingForModel } from "js-tiktoken";

// Rough estimate: ~4 characters per token for English text
const CHARS_PER_TOKEN = 4;

let encoder: ReturnType<typeof encodingForModel> | null = null;

function getEncoder() {
  if (!encoder) {
    // Use cl100k_base (GPT-4/Claude-compatible tokenizer)
    encoder = encodingForModel("gpt-4o");
  }
  return encoder;
}

/** Fast client-side estimate (no tokenizer needed) */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Accurate token count using tiktoken */
export function countTokensTiktoken(text: string): number {
  if (!text) return 0;
  try {
    const enc = getEncoder();
    return enc.encode(text).length;
  } catch {
    return estimateTokens(text);
  }
}

/** Count tokens for a specific provider model */
export async function countTokensForProvider(
  text: string,
  provider: "claude" | "openai",
  model?: string
): Promise<number> {
  // For now, use tiktoken for both
  // In the future, Claude provider can use the Anthropic countTokens API
  return countTokensTiktoken(text);
}
