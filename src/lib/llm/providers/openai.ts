import OpenAI from "openai";
import type {
  LLMProvider,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
} from "../provider";
import { countTokensTiktoken } from "../token-counter";

const DEFAULT_MODEL = "gpt-4o";

export class OpenAIProvider implements LLMProvider {
  name = "openai";
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI();
  }

  async generateCompletion(
    request: CompletionRequest
  ): Promise<CompletionResponse> {
    const response = await this.client.chat.completions.create({
      model: request.model || DEFAULT_MODEL,
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature ?? 0,
      messages: [
        { role: "system", content: request.systemMessage },
        { role: "user", content: request.userMessage },
      ],
    });

    return {
      content: response.choices[0]?.message.content || "",
      inputTokens: response.usage?.prompt_tokens || 0,
      outputTokens: response.usage?.completion_tokens || 0,
      model: response.model,
    };
  }

  async *generateStream(
    request: CompletionRequest
  ): AsyncIterable<StreamChunk> {
    const stream = await this.client.chat.completions.create({
      model: request.model || DEFAULT_MODEL,
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature ?? 0,
      messages: [
        { role: "system", content: request.systemMessage },
        { role: "user", content: request.userMessage },
      ],
      stream: true,
      stream_options: { include_usage: true },
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        yield { type: "text", content: delta.content };
      }

      if (chunk.usage) {
        yield {
          type: "usage",
          inputTokens: chunk.usage.prompt_tokens,
          outputTokens: chunk.usage.completion_tokens,
        };
      }
    }

    yield { type: "done" };
  }

  async countTokens(text: string): Promise<number> {
    return countTokensTiktoken(text);
  }
}
