import type { AssembledContext } from "./context-assembler";

interface CacheEntry {
  context: AssembledContext;
  createdAt: number;
}

const TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ENTRIES = 20;

const cache = new Map<string, CacheEntry>();

function makeKey(workspaceId: string, entityName: string, tokenBudget: number, query?: string): string {
  const base = `${workspaceId}:${entityName}:${tokenBudget}`;
  if (!query) return base;
  // Simple hash of the query string to keep cache keys manageable
  let hash = 0;
  for (let i = 0; i < query.length; i++) {
    hash = ((hash << 5) - hash + query.charCodeAt(i)) | 0;
  }
  return `${base}:q${hash}`;
}

export function getCachedContext(
  workspaceId: string,
  entityName: string,
  tokenBudget: number,
  query?: string
): AssembledContext | null {
  const key = makeKey(workspaceId, entityName, tokenBudget, query);
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
  context: AssembledContext,
  query?: string
): void {
  const key = makeKey(workspaceId, entityName, tokenBudget, query);

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
