export interface Evaluation {
  id: string;
  workspaceId: string;
  questionId: string;
  humanAnswer: string;
  aiAnswer: string | null;
  tokenOverlap: number | null;
  judgeScore: number | null;
  judgeReasoning: string | null;
  judgeModel: string | null;
  contextUsed: {
    skillsUsed: string[];
    contextIds: string[];
    totalTokens: number;
  } | null;
  aiProvider: string | null;
  aiModel: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  generationDurationMs: number | null;
  status: "pending" | "completed" | "failed";
  error: string | null;
  createdAt: string;
}

export interface EvalResult {
  evaluationId: string;
  questionId: string;
  humanAnswer: string;
  aiAnswer: string;
  tokenOverlap: number;
  judgeScore?: number;
  judgeReasoning?: string;
  judgeModel?: string;
  contextUsed: {
    skillsUsed: string[];
    contextIds: string[];
    totalTokens: number;
  };
  aiProvider: string;
  aiModel: string;
  inputTokens: number;
  outputTokens: number;
  generationDurationMs: number;
}

export interface EvaluationStats {
  totalEvaluations: number;
  avgJudgeScore: number | null;
  avgTokenOverlap: number | null;
}
