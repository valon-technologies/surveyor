import type { GenerationType } from "@/lib/constants";

export interface Generation {
  id: string;
  workspaceId: string;
  entityId: string | null;
  generationType: GenerationType;
  status: string;
  provider: string | null;
  model: string | null;
  promptSnapshot: {
    systemMessage: string;
    userMessage: string;
    skillsUsed: string[];
  } | null;
  output: string | null;
  outputParsed: Record<string, unknown> | null;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
