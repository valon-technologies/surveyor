import Anthropic from "@anthropic-ai/sdk";
import type {
  LLMProvider,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
} from "../provider";
import { countTokensTiktoken } from "../token-counter";

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

export class ClaudeProvider implements LLMProvider {
  name = "claude";
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic(apiKey ? { apiKey } : undefined);
  }

  async generateCompletion(
    request: CompletionRequest
  ): Promise<CompletionResponse> {
    const messages = request.messages ?? [
      { role: "user" as const, content: request.userMessage! },
    ];
    const response = await this.client.messages.create({
      model: request.model || DEFAULT_MODEL,
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature ?? 0,
      system: request.systemMessage,
      messages,
    });

    const content = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    return {
      content,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      model: response.model,
    };
  }

  async *generateStream(
    request: CompletionRequest
  ): AsyncIterable<StreamChunk> {
    const messages = request.messages ?? [
      { role: "user" as const, content: request.userMessage! },
    ];
    const stream = this.client.messages.stream({
      model: request.model || DEFAULT_MODEL,
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature ?? 0,
      system: request.systemMessage,
      messages,
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield { type: "text", content: event.delta.text };
      }
    }

    const finalMessage = await stream.finalMessage();
    yield {
      type: "usage",
      inputTokens: finalMessage.usage.input_tokens,
      outputTokens: finalMessage.usage.output_tokens,
    };

    yield { type: "done" };
  }

  async countTokens(text: string): Promise<number> {
    // Use tiktoken as a fallback; Anthropic's countTokens API could be used here
    return countTokensTiktoken(text);
  }
}
