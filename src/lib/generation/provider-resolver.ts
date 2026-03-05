import { db } from "@/lib/db";
import { userApiKey } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { decrypt } from "@/lib/auth/encryption";
import { ClaudeProvider } from "@/lib/llm/providers/claude";
import { OpenAIProvider } from "@/lib/llm/providers/openai";
import type { LLMProvider } from "@/lib/llm/provider";

interface ResolvedProvider {
  provider: LLMProvider;
  providerName: "claude" | "openai";
}

/**
 * Resolve an LLM provider from the user's stored API keys.
 * Preference order: preferredProvider > claude > openai.
 */
export async function resolveProvider(
  userId: string,
  preferredProvider?: "claude" | "openai"
): Promise<ResolvedProvider> {
  const keys = await db
    .select()
    .from(userApiKey)
    .where(eq(userApiKey.userId, userId))
    ;

  if (keys.length === 0) {
    throw new Error(
      "No API keys configured. Add your API key in Settings > API Keys."
    );
  }

  // Build a map of provider -> decrypted key
  const keyMap = new Map<string, string>();
  for (const k of keys) {
    try {
      const decrypted = decrypt(k.encryptedKey, k.iv, k.authTag);
      keyMap.set(k.provider, decrypted);
    } catch {
      // Skip keys that fail to decrypt
    }
  }

  // Pick provider in preference order
  const order: Array<"claude" | "openai"> = preferredProvider
    ? [preferredProvider, preferredProvider === "claude" ? "openai" : "claude"]
    : ["claude", "openai"];

  for (const name of order) {
    const apiKey = keyMap.get(name);
    if (apiKey) {
      const provider =
        name === "claude" ? new ClaudeProvider(apiKey) : new OpenAIProvider(apiKey);
      return { provider, providerName: name };
    }
  }

  throw new Error(
    "No valid API keys found. Check your API keys in Settings > API Keys."
  );
}

/**
 * Get the context token budget for a provider.
 * This is the budget for CONTEXT ONLY (reference docs, enum tables, etc.).
 * The full prompt also includes the system message (~5K tokens for JSON,
 * ~5K for YAML + gold examples/renderer refs in user message ~20-40K),
 * source schema (~5-15K), and target fields (~2-5K).
 *
 * Claude 200K model: actual tokenization ~3.1 chars/token for structured YAML/markdown
 * (not the assumed 4), so actual overhead is ~85K, not 50K. Budget set conservatively.
 * Claude 200K model: 200K limit - 16K output - 85K overhead ≈ 99K for context → use 80K
 * OpenAI GPT-4o 128K: 128K limit - 8K output - 30K prompt overhead ≈ 90K for context
 */
export function getTokenBudget(providerName: "claude" | "openai"): number {
  return providerName === "claude" ? 80_000 : 90_000;
}
