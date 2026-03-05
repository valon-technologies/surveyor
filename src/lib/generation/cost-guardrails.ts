import { db } from "@/lib/db";
import { generation } from "@/lib/db/schema";
import { eq, and, gte, sql } from "drizzle-orm";

/**
 * Default daily token budget per workspace.
 * At Opus pricing ($15/M input, $75/M output), 2M tokens ≈ $30-150 worst case.
 * Override via DAILY_TOKEN_BUDGET env var.
 */
const DEFAULT_DAILY_TOKEN_BUDGET = 2_000_000;

function getDailyTokenBudget(): number {
  const envBudget = process.env.DAILY_TOKEN_BUDGET;
  if (envBudget) {
    const parsed = parseInt(envBudget, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_DAILY_TOKEN_BUDGET;
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  budget: number;
  remaining: number;
}

/**
 * Get today's total token usage for a workspace by summing all generations
 * created since midnight UTC.
 */
export async function getDailyTokenUsage(workspaceId: string): Promise<TokenUsage> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayISO = todayStart.toISOString();

  const result = (await db
    .select({
      totalInput: sql<number>`COALESCE(SUM(${generation.inputTokens}), 0)`,
      totalOutput: sql<number>`COALESCE(SUM(${generation.outputTokens}), 0)`,
    })
    .from(generation)
    .where(
      and(
        eq(generation.workspaceId, workspaceId),
        gte(generation.createdAt, todayISO),
      ),
    )
    )[0]!;

  const budget = getDailyTokenBudget();
  const totalTokens = result.totalInput + result.totalOutput;

  return {
    inputTokens: result.totalInput,
    outputTokens: result.totalOutput,
    totalTokens,
    budget,
    remaining: Math.max(0, budget - totalTokens),
  };
}

interface BudgetCheckResult {
  allowed: boolean;
  usage: TokenUsage;
  message?: string;
}

/**
 * Check whether a workspace is within its daily token budget.
 * Call this before starting any generation or batch run.
 */
export async function checkDailyTokenBudget(workspaceId: string): Promise<BudgetCheckResult> {
  const usage = await getDailyTokenUsage(workspaceId);

  if (usage.totalTokens >= usage.budget) {
    const inputCost = (usage.inputTokens / 1_000_000) * 15;
    const outputCost = (usage.outputTokens / 1_000_000) * 75;
    const totalCost = inputCost + outputCost;

    return {
      allowed: false,
      usage,
      message:
        `Daily token budget exceeded. ` +
        `Used ${(usage.totalTokens / 1_000_000).toFixed(2)}M of ${(usage.budget / 1_000_000).toFixed(1)}M tokens today ` +
        `(~$${totalCost.toFixed(2)} at Opus rates). ` +
        `Budget resets at midnight UTC. ` +
        `Override with DAILY_TOKEN_BUDGET env var.`,
    };
  }

  return { allowed: true, usage };
}
