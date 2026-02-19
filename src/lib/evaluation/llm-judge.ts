import type { LLMProvider } from "@/lib/llm/provider";

interface JudgeInput {
  question: string;
  humanAnswer: string;
  aiAnswer: string;
  provider: LLMProvider;
}

interface JudgeResult {
  score: number; // 1-5
  reasoning: string;
  model: string;
}

const JUDGE_SYSTEM_PROMPT = `You are an expert evaluator comparing AI-generated answers against human expert answers for data mapping questions.

Score the AI answer on a 1-5 scale:
5 = Same conclusion and substance as the human answer
4 = Mostly correct, minor detail differences
3 = Partially correct, key information missing
2 = Addresses the question but reaches wrong conclusion
1 = Wrong or irrelevant

Respond in exactly this format:
SCORE: <number>
REASONING: <one paragraph explanation>`;

/**
 * Use an LLM as a judge to score the AI answer against the human expert answer.
 */
export async function judgeAnswer(input: JudgeInput): Promise<JudgeResult> {
  const { question, humanAnswer, aiAnswer, provider } = input;

  const userMessage = [
    "## Question",
    question,
    "",
    "## Human Expert Answer",
    humanAnswer,
    "",
    "## AI Answer",
    aiAnswer,
  ].join("\n");

  const response = await provider.generateCompletion({
    systemMessage: JUDGE_SYSTEM_PROMPT,
    userMessage,
    temperature: 0,
    maxTokens: 500,
  });

  // Parse the response
  const scoreMatch = response.content.match(/SCORE:\s*(\d)/);
  const reasoningMatch = response.content.match(/REASONING:\s*([\s\S]+)/);

  const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 3;
  const reasoning = reasoningMatch
    ? reasoningMatch[1].trim()
    : response.content;

  return {
    score: Math.max(1, Math.min(5, score)),
    reasoning,
    model: response.model,
  };
}
