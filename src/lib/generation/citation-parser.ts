/**
 * Parse [ref:ctx_ID] citation tags from LLM output text.
 * Returns the set of context IDs that were actually cited.
 */

const CITATION_PATTERN = /\[ref:ctx_([a-f0-9-]+)\]/gi;

/** Extract unique context IDs cited in one or more text fields */
export function extractCitations(...texts: (string | null | undefined)[]): Set<string> {
  const cited = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    let match: RegExpExecArray | null;
    CITATION_PATTERN.lastIndex = 0;
    while ((match = CITATION_PATTERN.exec(text)) !== null) {
      cited.add(match[1]);
    }
  }
  return cited;
}

/** Strip [ref:ctx_ID] tags from display text, leaving the surrounding prose intact */
export function stripCitations(text: string): string {
  return text.replace(CITATION_PATTERN, "").replace(/\s{2,}/g, " ").trim();
}
