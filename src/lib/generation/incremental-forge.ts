/**
 * Incremental Forge — lightweight skill refresh driven by accumulated signals.
 *
 * Unlike full Forge sessions (interactive, user-driven), incremental forge:
 * 1. Loads current skill config + accumulated signals
 * 2. Runs a focused LLM call to propose targeted changes
 * 3. Diffs proposed vs current → produces a SkillRefreshProposal
 * 4. Auto-applies low-risk changes, queues high-risk for human review
 */

import { db } from "@/lib/db";
import {
  skill,
  skillContext,
  skillRefresh,
  context,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import type { LLMProvider } from "@/lib/llm/provider";
import { resolveProvider } from "./provider-resolver";
import {
  type SignalType,
  evaluateSignals,
  markSignalsProcessed,
} from "./skill-signals";
import {
  type SkillRefreshProposal,
  scoreProposalRisk,
  canAutoApply,
  autoApplyProposal,
} from "./auto-apply";
import { matchSkills } from "./context-assembler";
import { executeForgeToolCall } from "./forge-tools";

// ─── Types ─────────────────────────────────────────────────────

interface IncrementalForgeInput {
  workspaceId: string;
  skillId: string;
  entityId: string;
  userId: string;
}

interface IncrementalForgeResult {
  refreshId: string;
  proposal: SkillRefreshProposal;
  autoApplyable: boolean;
  autoApplied: boolean;
  status: string;
}

interface CurrentSkillConfig {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  contexts: {
    contextId: string;
    contextName: string;
    role: string;
    tokenCount: number | null;
  }[];
  totalTokens: number;
}

// ─── Main Entry Point ──────────────────────────────────────────

/**
 * Run an incremental forge for a skill based on accumulated signals.
 *
 * Flow:
 * 1. Load current skill config
 * 2. Load unprocessed signals for the entity
 * 3. Build a focused prompt with signal context
 * 4. Call LLM to propose changes (uses tool calls for context search/read)
 * 5. Parse proposal, score risk, auto-apply or queue
 */
export async function runIncrementalForge(
  input: IncrementalForgeInput,
): Promise<IncrementalForgeResult> {
  const { workspaceId, skillId, entityId, userId } = input;

  // Load current skill config
  const currentConfig = loadSkillConfig(skillId);
  if (!currentConfig) {
    throw new Error(`Skill ${skillId} not found`);
  }

  // Evaluate signals
  const signalEval = evaluateSignals(workspaceId, entityId);
  if (signalEval.signals.length === 0) {
    throw new Error("No unprocessed signals for this entity");
  }

  // Create refresh record
  const [refresh] = db
    .insert(skillRefresh)
    .values({
      workspaceId,
      skillId,
      status: "running",
      triggerScore: signalEval.score,
      signalCount: signalEval.signals.length,
    })
    .returning()
    .all();

  try {
    // Resolve LLM provider
    const { provider } = resolveProvider(userId, "claude");

    // Build incremental prompt and run LLM
    const proposal = await generateProposal(
      provider,
      workspaceId,
      currentConfig,
      signalEval.signals,
    );

    // Score risk
    const riskScore = scoreProposalRisk(proposal);
    proposal.riskScore = riskScore;

    // Update refresh with proposal
    db.update(skillRefresh)
      .set({
        status: "proposed",
        proposal,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(skillRefresh.id, refresh.id))
      .run();

    // Auto-apply if low risk
    const autoApplyable = canAutoApply(proposal);
    let autoApplied = false;

    if (autoApplyable) {
      const result = autoApplyProposal(
        workspaceId,
        skillId,
        proposal,
        refresh.id,
      );
      autoApplied = result.applied;
    }

    // Mark signals as processed
    markSignalsProcessed(signalEval.signals.map((s) => s.id));

    const finalStatus = autoApplied ? "auto_applied" : "proposed";

    return {
      refreshId: refresh.id,
      proposal,
      autoApplyable,
      autoApplied,
      status: finalStatus,
    };
  } catch (err) {
    // Mark refresh as failed
    db.update(skillRefresh)
      .set({
        status: "failed",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(skillRefresh.id, refresh.id))
      .run();

    throw err;
  }
}

// ─── Skill Config Loading ──────────────────────────────────────

function loadSkillConfig(skillId: string): CurrentSkillConfig | null {
  const s = db.select().from(skill).where(eq(skill.id, skillId)).get();
  if (!s) return null;

  const assignments = db
    .select({
      contextId: skillContext.contextId,
      role: skillContext.role,
      contextName: context.name,
      tokenCount: context.tokenCount,
    })
    .from(skillContext)
    .innerJoin(context, eq(skillContext.contextId, context.id))
    .where(eq(skillContext.skillId, skillId))
    .orderBy(skillContext.sortOrder)
    .all();

  const totalTokens = assignments.reduce(
    (sum, a) => sum + (a.tokenCount || 0),
    0,
  );

  return {
    id: s.id,
    name: s.name,
    description: s.description,
    instructions: s.instructions,
    contexts: assignments,
    totalTokens,
  };
}

// ─── Prompt Building ───────────────────────────────────────────

function buildIncrementalForgePrompt(
  config: CurrentSkillConfig,
  signals: { type: SignalType; summary: string; createdAt: string }[],
): string {
  const signalList = signals
    .map((s) => `- [${s.type}] ${s.summary} (${s.createdAt.split("T")[0]})`)
    .join("\n");

  const contextList = config.contexts
    .map(
      (c) =>
        `- [${c.role}] ${c.contextName} (${c.tokenCount || "?"} tokens) — ID: ${c.contextId}`,
    )
    .join("\n");

  return `You are an incremental skill curator. Your job is to propose targeted changes to an existing mapping skill based on recent events (signals).

## Current Skill: ${config.name}

${config.description || "No description."}

### Current Context Assignments (${config.contexts.length} contexts, ~${config.totalTokens} tokens)
${contextList}

${config.instructions ? `### Current Instructions\n${config.instructions}\n` : ""}

## Recent Signals

These events happened since the last skill update:
${signalList}

## Your Task

Based on these signals, propose **targeted changes** to the skill. You are NOT doing a full review — only address what the signals indicate.

### Available Actions
1. **Add a context** — if a signal reveals a gap (e.g., a resolved question created a QA Knowledge context that should be linked)
2. **Remove a context** — if a signal indicates a context is misleading or outdated
3. **Change a context's role** — e.g., promote supplementary→reference if it proved critical
4. **Update instructions** — if signals reveal gotchas the mapping agent should know

### Rules
- Only propose changes justified by the signals
- Prefer supplementary/reference additions (low risk) over primary changes
- Use \`search_contexts\` and \`read_context\` to verify contexts before proposing additions
- Use \`get_mapping_feedback\` to check how the current skill performs

### Output Format

After your analysis, output EXACTLY ONE \`skill-refresh\` fenced block:

\`\`\`skill-refresh
{
  "additions": [
    { "contextId": "uuid", "contextName": "Name", "role": "supplementary" }
  ],
  "removals": [
    { "contextId": "uuid", "contextName": "Name" }
  ],
  "roleChanges": [
    { "contextId": "uuid", "contextName": "Name", "fromRole": "supplementary", "toRole": "reference" }
  ],
  "instructionUpdate": "New instruction text or null if unchanged"
}
\`\`\`

If no changes are warranted, output an empty proposal (empty arrays, no instructionUpdate).`;
}

// ─── LLM Interaction ───────────────────────────────────────────

const MAX_TOOL_ROUNDS = 6;

async function generateProposal(
  provider: LLMProvider,
  workspaceId: string,
  config: CurrentSkillConfig,
  signals: { type: SignalType; summary: string; createdAt: string }[],
): Promise<SkillRefreshProposal> {
  const systemMessage = buildIncrementalForgePrompt(config, signals);

  // Subset of forge tools relevant to incremental refresh
  const tools = [
    {
      name: "search_contexts",
      description:
        "Search the context library by keyword. Returns IDs, names, categories, token counts.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Keywords to search for",
          },
          limit: {
            type: "number",
            description: "Max results (default 10)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "read_context",
      description: "Read full content of a context by ID.",
      inputSchema: {
        type: "object" as const,
        properties: {
          contextId: {
            type: "string",
            description: "The context ID to read",
          },
        },
        required: ["contextId"],
      },
    },
    {
      name: "get_mapping_feedback",
      description:
        "Get mapping quality feedback — confidence distribution, unmapped fields, problem fields.",
      inputSchema: {
        type: "object" as const,
        properties: {
          entityId: {
            type: "string",
            description: "The target entity ID",
          },
        },
        required: ["entityId"],
      },
    },
  ];

  // Agentic loop: let the LLM call tools then produce its final answer
  const messages: Array<{
    role: "user" | "assistant";
    content: string | Array<Record<string, unknown>>;
  }> = [
    { role: "user", content: "Analyze the signals and propose targeted skill changes." },
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await provider.generateCompletion({
      systemMessage,
      messages,
      tools,
      temperature: 0.3,
      maxTokens: 4096,
    });

    // If no tool calls, this is the final response
    if (!response.toolCalls || response.toolCalls.length === 0) {
      return parseProposal(response.content);
    }

    // Build assistant message with text + tool_use blocks
    const assistantContent: Array<Record<string, unknown>> = [];
    if (response.content) {
      assistantContent.push({ type: "text", text: response.content });
    }
    for (const tc of response.toolCalls) {
      assistantContent.push({
        type: "tool_use",
        id: tc.id,
        name: tc.name,
        input: tc.input,
      });
    }
    messages.push({ role: "assistant", content: assistantContent });

    // Execute tools and build user response
    const toolResults: Array<Record<string, unknown>> = [];
    for (const tc of response.toolCalls) {
      const result = executeForgeToolCall(tc.name, tc.input, workspaceId);
      toolResults.push({
        type: "tool_result",
        tool_use_id: tc.id,
        content: result.data,
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  // If we exhausted tool rounds, try to extract proposal from last assistant message
  const lastAssistant = messages
    .filter((m) => m.role === "assistant")
    .pop();
  if (lastAssistant) {
    const text =
      typeof lastAssistant.content === "string"
        ? lastAssistant.content
        : lastAssistant.content
            .filter((b) => (b as any).type === "text")
            .map((b) => (b as any).text)
            .join("\n");
    return parseProposal(text);
  }

  // Fallback: empty proposal
  return {
    additions: [],
    removals: [],
    roleChanges: [],
    riskScore: 0,
  };
}

// ─── Proposal Parsing ──────────────────────────────────────────

function parseProposal(text: string): SkillRefreshProposal {
  // Extract skill-refresh fenced block
  const blockMatch = text.match(
    /```skill-refresh\s*\n([\s\S]*?)```/,
  );

  if (!blockMatch) {
    // Try to find JSON object directly
    const jsonMatch = text.match(
      /\{[\s\S]*"additions"[\s\S]*"removals"[\s\S]*\}/,
    );
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return normalizeProposal(parsed);
      } catch {
        // Fall through to empty proposal
      }
    }
    return {
      additions: [],
      removals: [],
      roleChanges: [],
      riskScore: 0,
    };
  }

  try {
    const parsed = JSON.parse(blockMatch[1].trim());
    return normalizeProposal(parsed);
  } catch {
    return {
      additions: [],
      removals: [],
      roleChanges: [],
      riskScore: 0,
    };
  }
}

function normalizeProposal(raw: Record<string, unknown>): SkillRefreshProposal {
  const additions = Array.isArray(raw.additions)
    ? raw.additions.map((a: any) => ({
        contextId: String(a.contextId || ""),
        contextName: String(a.contextName || ""),
        role: String(a.role || "supplementary"),
      }))
    : [];

  const removals = Array.isArray(raw.removals)
    ? raw.removals.map((r: any) => ({
        contextId: String(r.contextId || ""),
        contextName: String(r.contextName || ""),
      }))
    : [];

  const roleChanges = Array.isArray(raw.roleChanges)
    ? raw.roleChanges.map((rc: any) => ({
        contextId: String(rc.contextId || ""),
        contextName: String(rc.contextName || ""),
        fromRole: String(rc.fromRole || ""),
        toRole: String(rc.toRole || ""),
      }))
    : [];

  const proposal: SkillRefreshProposal = {
    additions,
    removals,
    roleChanges,
    instructionUpdate:
      typeof raw.instructionUpdate === "string"
        ? raw.instructionUpdate
        : undefined,
    riskScore: 0,
  };

  // Validate context IDs exist
  proposal.additions = proposal.additions.filter((a) => {
    if (!a.contextId) return false;
    const exists = db
      .select({ id: context.id })
      .from(context)
      .where(eq(context.id, a.contextId))
      .get();
    return !!exists;
  });

  proposal.removals = proposal.removals.filter((r) => !!r.contextId);
  proposal.roleChanges = proposal.roleChanges.filter(
    (rc) => !!rc.contextId && rc.fromRole !== rc.toRole,
  );

  // Compute risk score
  proposal.riskScore = scoreProposalRisk(proposal);

  return proposal;
}
