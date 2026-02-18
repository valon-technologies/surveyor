import type { AssembledContext } from "./context-assembler";

interface CacheEntry {
  context: AssembledContext;
  createdAt: number;
}

const TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ENTRIES = 20;

const cache = new Map<string, CacheEntry>();

function makeKey(workspaceId: string, entityName: string, tokenBudget: number): string {
  return `${workspaceId}:${entityName}:${tokenBudget}`;
}

export function getCachedContext(
  workspaceId: string,
  entityName: string,
  tokenBudget: number
): AssembledContext | null {
  const key = makeKey(workspaceId, entityName, tokenBudget);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.context;
}

export function setCachedContext(
  workspaceId: string,
  entityName: string,
  tokenBudget: number,
  context: AssembledContext
): void {
  const key = makeKey(workspaceId, entityName, tokenBudget);

  // Evict oldest if at capacity
  if (cache.size >= MAX_ENTRIES && !cache.has(key)) {
    const oldest = cache.keys().next().value!;
    cache.delete(oldest);
  }

  cache.set(key, { context, createdAt: Date.now() });
}

export function invalidateWorkspaceContextCache(workspaceId: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(workspaceId + ":")) {
      cache.delete(key);
    }
  }
}

export function clearContextCache(): void {
  cache.clear();
}
