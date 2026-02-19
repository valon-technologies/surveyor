import type { ToolDefinition } from "@/lib/llm/provider";
import { db } from "@/lib/db";
import { context } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { searchContextsFts } from "./fts5-search";

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

  // Count total active contexts for stats
  const allContexts = db
    .select({ id: context.id })
    .from(context)
    .where(and(eq(context.workspaceId, workspaceId), eq(context.isActive, true)))
    .all();

  // Use FTS5 for ranked retrieval (falls back gracefully if table doesn't exist)
  const ftsResults = searchContextsFts(workspaceId, query, 10);

  // Load full context records for FTS matches
  let topDocs: ScoredDoc[] = [];
  if (ftsResults.length > 0) {
    const ftsIds = ftsResults.map((r) => r.contextId);
    const ftsContexts = db
      .select()
      .from(context)
      .where(inArray(context.id, ftsIds))
      .all();

    // Build a rank map for ordering
    const rankMap = new Map(ftsResults.map((r) => [r.contextId, r.rank]));

    // Apply optional category/subcategory filters
    let filtered = ftsContexts;
    if (category) {
      filtered = filtered.filter((c) => c.category === category);
    }
    if (subcategory) {
      filtered = filtered.filter((c) => c.subcategory === subcategory);
    }

    topDocs = filtered
      .map((ctx) => ({
        id: ctx.id,
        name: ctx.name,
        category: ctx.category,
        subcategory: ctx.subcategory,
        content: ctx.content || "",
        tokenCount: ctx.tokenCount,
        tags: ctx.tags,
        score: -(rankMap.get(ctx.id) ?? 0), // FTS5 rank is negative, lower = better
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }

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
