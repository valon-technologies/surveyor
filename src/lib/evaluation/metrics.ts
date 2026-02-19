/**
 * Jaccard similarity on normalized word tokens.
 * Returns 0–100 representing percentage overlap.
 */
export function tokenOverlap(textA: string, textB: string): number {
  const tokensA = normalizeToTokens(textA);
  const tokensB = normalizeToTokens(textB);

  if (tokensA.size === 0 && tokensB.size === 0) return 100;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }

  const union = tokensA.size + tokensB.size - intersection;
  return Math.round((intersection / union) * 100);
}

function normalizeToTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1) // skip single chars
  );
}
