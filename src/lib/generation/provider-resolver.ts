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
export function resolveProvider(
  userId: string,
  preferredProvider?: "claude" | "openai"
): ResolvedProvider {
  const keys = db
    .select()
    .from(userApiKey)
    .where(eq(userApiKey.userId, userId))
    .all();

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
 * Get the context window token budget for a provider.
 * Leaves room for output tokens and overhead.
 */
export function getTokenBudget(providerName: "claude" | "openai"): number {
  // Claude: 200K context, budget ~160K for input (leaving 8K output + overhead)
  // OpenAI GPT-4o: 128K context, budget ~100K for input
  return providerName === "claude" ? 160_000 : 100_000;
}
