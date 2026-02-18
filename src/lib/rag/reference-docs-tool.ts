import type { ToolDefinition } from "@/lib/llm/provider";
import { db } from "@/lib/db";
import { context } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

// ─── Types ─────────────────────────────────────────────────────

export interface ReferenceDocsInput {
  query: string;
  category?: string;
  subcategory?: string;
  maxTokens?: number;
}

interface ScoredDoc {
  id: string;
  name: string;
  category: string;
  subcategory: string | null;
  content: string;
  tokenCount: number | null;
  tags: string[] | null;
  score: number;
}

export interface ReferenceDocsResult {
  success: boolean;
  query: string;
  documents: { name: string; category: string; subcategory: string | null; content: string; truncated: boolean }[];
  totalAvailable: number;
  error?: string;
}

// ─── Definition ────────────────────────────────────────────────

export function getReferenceDocsToolDefinition(): ToolDefinition {
  return {
    name: "get_reference_docs",
    description:
      "Retrieve domain reference documents, business rules, code breakers, and conventions. " +
      "Use this when you need to understand a domain concept, lookup business rules, or find " +
      "conventions like Hash ID patterns, table authority rules, or enum/lookup mappings.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description:
            "Search keyword(s) to match against document names, tags, and content prefix. " +
            "Examples: 'hash id convention', 'table authority', 'GSE codes', 'escrow'",
        },
        category: {
          type: "string",
          description:
            "Optional: filter by category — 'foundational', 'schema', or 'adhoc'",
        },
        subcategory: {
          type: "string",
          description:
            "Optional: filter by subcategory — 'domain_knowledge', 'business_rules', " +
            "'glossary', 'code_breaker', etc.",
        },
        maxTokens: {
          type: "number",
          description: "Max tokens per document (default 4000, max 8000). Longer docs are truncated.",
        },
      },
      required: ["query"],
    },
  };
}

// ─── Executor ──────────────────────────────────────────────────

export function executeReferenceDocRetrieval(
  input: ReferenceDocsInput,
  workspaceId: string
): ReferenceDocsResult {
  const { query, category, subcategory, maxTokens: rawMaxTokens } = input;
  const tokenCap = Math.min(rawMaxTokens || 4000, 8000);
  const queryLower = query.toLowerCase();
  const queryTokens = queryLower.split(/\s+/).filter(Boolean);

  // Load active contexts for workspace
  const allContexts = db
    .select()
    .from(context)
    .where(and(eq(context.workspaceId, workspaceId), eq(context.isActive, true)))
    .all();

  // Apply optional filters
  let filtered = allContexts;
  if (category) {
    filtered = filtered.filter((c) => c.category === category);
  }
  if (subcategory) {
    filtered = filtered.filter((c) => c.subcategory === subcategory);
  }

  // Score each context
  const scored: ScoredDoc[] = [];

  for (const ctx of filtered) {
    const nameLower = ctx.name.toLowerCase();
    const nameNormalized = nameLower.replace(/[_\s-]/g, "");
    const queryNormalized = queryLower.replace(/[_\s-]/g, "");
    const tags = (ctx.tags || []).map((t) => t.toLowerCase());
    // Only check first 500 chars of content for scoring (avoid scanning huge docs)
    const contentPrefix = (ctx.content || "").slice(0, 500).toLowerCase();

    let score = 0;

    // Exact name match
    if (nameNormalized === queryNormalized) {
      score = 10;
    }
    // Name contains all query tokens
    else if (queryTokens.every((t) => nameLower.includes(t))) {
      score = 8;
    }
    // Tag match (all tokens)
    else if (queryTokens.every((t) => tags.some((tag) => tag.includes(t)))) {
      score = 7;
    }
    // Name contains any token
    else if (queryTokens.some((t) => nameLower.includes(t))) {
      score = 5;
    }
    // Tag match (any token)
    else if (queryTokens.some((t) => tags.some((tag) => tag.includes(t)))) {
      score = 4;
    }
    // Content prefix match (all tokens)
    else if (queryTokens.every((t) => contentPrefix.includes(t))) {
      score = 3;
    }
    // Content prefix match (any token)
    else if (queryTokens.some((t) => contentPrefix.includes(t))) {
      score = 2;
    }

    if (score > 0) {
      scored.push({
        id: ctx.id,
        name: ctx.name,
        category: ctx.category,
        subcategory: ctx.subcategory,
        content: ctx.content || "",
        tokenCount: ctx.tokenCount,
        tags: ctx.tags,
        score,
      });
    }
  }

  // Sort by score desc, take top 3
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const topDocs = scored.slice(0, 3);

  // Truncate content to token cap (rough: 1 token ≈ 4 chars)
  const charCap = tokenCap * 4;
  const documents = topDocs.map((doc) => {
    const truncated = doc.content.length > charCap;
    return {
      name: doc.name,
      category: doc.category,
      subcategory: doc.subcategory,
      content: truncated ? doc.content.slice(0, charCap) + "\n\n[... truncated]" : doc.content,
      truncated,
    };
  });

  return {
    success: true,
    query,
    documents,
    totalAvailable: allContexts.length,
  };
}

// ─── Formatters ────────────────────────────────────────────────

export function formatReferenceDocsForLLM(result: ReferenceDocsResult): string {
  if (!result.success) {
    return `Reference doc retrieval failed: ${result.error}`;
  }

  if (result.documents.length === 0) {
    return `No reference documents matched "${result.query}". Try different keywords or check available categories.`;
  }

  const parts: string[] = [];
  parts.push(`Found ${result.documents.length} document(s) for "${result.query}":\n`);

  for (const doc of result.documents) {
    const meta = [doc.category, doc.subcategory].filter(Boolean).join(" > ");
    const truncLabel = doc.truncated ? " (truncated)" : "";
    parts.push(`### ${doc.name} [${meta}]${truncLabel}\n`);
    parts.push(doc.content);
    parts.push("");
  }

  return parts.join("\n");
}

export function formatReferenceDocsForClient(result: ReferenceDocsResult): {
  toolName: string;
  query: string;
  documentCount: number;
  documentNames: string[];
  success: boolean;
  error?: string;
} {
  return {
    toolName: "get_reference_docs",
    query: result.query,
    documentCount: result.documents.length,
    documentNames: result.documents.map((d) => d.name),
    success: result.success,
    error: result.error,
  };
}
