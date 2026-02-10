import type { MappingWithContext } from "@/types/mapping";

// --- Types ---

export interface Snippet {
  text: string;
  matchedTerms: string[];
  lineNumber: number;
}

export interface PromptSection {
  name: string;
  role: "Primary" | "Reference" | "Supplementary" | "Other";
  content: string;
}

export interface RankedSection extends PromptSection {
  score: number;
  snippets: Snippet[];
}

export type TermCategory = "source" | "target" | "other";

export interface CategorizedTerm {
  term: string;
  category: TermCategory;
}

// --- Constants ---

const NOISE_WORDS = new Set([
  "the", "and", "for", "from", "with", "that", "this", "not", "are", "was",
  "has", "had", "will", "can", "may", "all", "any", "but", "our", "its",
  "null", "true", "false", "select", "from", "where", "join", "left",
  "right", "inner", "outer", "case", "when", "then", "else", "end",
  "group", "order", "having", "limit", "offset", "insert", "update",
  "delete", "create", "alter", "drop", "table", "index", "into", "values",
  "set", "union", "distinct", "count", "sum", "avg", "min", "max",
  "coalesce", "cast", "trim", "upper", "lower", "like", "between",
]);

// --- Term Extraction ---

export function extractKeyTerms(mapping: MappingWithContext): CategorizedTerm[] {
  const terms: CategorizedTerm[] = [];
  const seen = new Set<string>();

  function add(term: string, category: TermCategory) {
    const lower = term.toLowerCase();
    if (seen.has(lower)) return;
    if (term.length < 3) return;
    if (NOISE_WORDS.has(lower)) return;
    seen.add(lower);
    terms.push({ term, category });
  }

  // Source references
  if (mapping.sourceField) {
    add(mapping.sourceField.entityName, "source");
    add(mapping.sourceField.name, "source");
  }

  // Target references
  if (mapping.targetField) {
    add(mapping.targetField.entityName, "target");
    add(mapping.targetField.name, "target");
  }

  // Extract entity.field patterns from reasoning and transform
  const textSources = [mapping.reasoning, mapping.transform].filter(Boolean).join(" ");

  // entity.field patterns
  const dotPatterns = textSources.matchAll(/\b(\w{3,}\.\w{3,})\b/g);
  for (const m of dotPatterns) {
    add(m[1], "other");
    // Also add parts individually
    const parts = m[1].split(".");
    add(parts[0], "other");
    add(parts[1], "other");
  }

  // Quoted strings from reasoning
  if (mapping.reasoning) {
    const singleQuoted = mapping.reasoning.matchAll(/'([^']{3,40})'/g);
    for (const m of singleQuoted) add(m[1], "other");

    const doubleQuoted = mapping.reasoning.matchAll(/"([^"]{3,40})"/g);
    for (const m of doubleQuoted) add(m[1], "other");
  }

  return terms;
}

/** Flat list of term strings (for simple matching) */
export function extractTermStrings(mapping: MappingWithContext): string[] {
  return extractKeyTerms(mapping).map((t) => t.term);
}

/** Build a map from term → category for color coding */
export function buildTermCategoryMap(mapping: MappingWithContext): Map<string, TermCategory> {
  const map = new Map<string, TermCategory>();
  for (const { term, category } of extractKeyTerms(mapping)) {
    if (!map.has(term)) {
      map.set(term, category);
    }
  }
  return map;
}

// --- Prompt Section Parsing ---

const ROLE_HEADERS: Record<string, PromptSection["role"]> = {
  "Primary Reference Documents": "Primary",
  "Reference Materials": "Reference",
  "Supplementary Context": "Supplementary",
};

export function parsePromptSections(userMessage: string): PromptSection[] {
  const sections: PromptSection[] = [];
  let currentRole: PromptSection["role"] = "Other";

  const lines = userMessage.split("\n");
  let currentName: string | null = null;
  let currentContent: string[] = [];

  function flush() {
    if (currentName && currentContent.length > 0) {
      sections.push({
        name: currentName,
        role: currentRole,
        content: currentContent.join("\n").trim(),
      });
    }
    currentContent = [];
  }

  for (const line of lines) {
    // Check for ## role headers
    const h2Match = line.match(/^## (.+)$/);
    if (h2Match) {
      flush();
      currentName = null;
      const headerText = h2Match[1].trim();
      // Check if it matches a known role header (strip any trailing content like field counts)
      for (const [key, role] of Object.entries(ROLE_HEADERS)) {
        if (headerText.startsWith(key)) {
          currentRole = role;
          break;
        }
      }
      continue;
    }

    // Check for ### context name headers
    const h3Match = line.match(/^### (.+)$/);
    if (h3Match) {
      flush();
      currentName = h3Match[1].trim();
      continue;
    }

    // Accumulate content
    if (currentName) {
      currentContent.push(line);
    }
  }

  flush();
  return sections;
}

// --- Scoring & Ranking ---

export function rankSections(
  sections: PromptSection[],
  terms: string[]
): RankedSection[] {
  if (terms.length === 0) return [];

  const ranked: RankedSection[] = sections.map((section) => {
    const snippets = extractSnippets(section.content, terms);
    const matchedTerms = new Set(snippets.flatMap((s) => s.matchedTerms));
    return {
      ...section,
      score: matchedTerms.size,
      snippets,
    };
  });

  return ranked
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
}

// --- Snippet Extraction ---

export function extractSnippets(
  content: string,
  terms: string[],
  windowLines: number = 1
): Snippet[] {
  if (terms.length === 0) return [];

  const lines = content.split("\n");
  const snippets: Snippet[] = [];
  const usedLines = new Set<number>();

  // Build regex for all terms (case-insensitive, word boundary where possible)
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(?:${escaped.join("|")})`, "gi");

  for (let i = 0; i < lines.length; i++) {
    if (usedLines.has(i)) continue;

    const matches = lines[i].match(pattern);
    if (!matches) continue;

    // Extract window around match
    const start = Math.max(0, i - windowLines);
    const end = Math.min(lines.length - 1, i + windowLines);

    // Mark lines as used
    for (let j = start; j <= end; j++) usedLines.add(j);

    const windowText = lines.slice(start, end + 1).join("\n");
    const matchedTerms = [...new Set(matches.map((m) => m.toLowerCase()))];

    snippets.push({
      text: windowText,
      matchedTerms,
      lineNumber: i + 1,
    });
  }

  return snippets;
}

// --- Highlighting Utilities ---

/**
 * Split text into segments for React rendering with highlighted terms.
 * Returns an array of { text, category } segments where category is null for plain text.
 */
export interface HighlightSegment {
  text: string;
  category: TermCategory | "evidence" | null;
}

export function highlightTermSegments(
  text: string,
  termMap: Map<string, TermCategory | "evidence">
): HighlightSegment[] {
  if (termMap.size === 0) return [{ text, category: null }];

  const escaped = [...termMap.keys()]
    .sort((a, b) => b.length - a.length) // longest first for greedy matching
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  const pattern = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(pattern);

  return parts
    .filter((p) => p.length > 0)
    .map((part) => {
      // Check if this part matches any term (case-insensitive)
      for (const [term, category] of termMap) {
        if (part.toLowerCase() === term.toLowerCase()) {
          return { text: part, category };
        }
      }
      return { text: part, category: null };
    });
}
