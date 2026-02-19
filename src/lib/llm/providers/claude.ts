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

    // Build Anthropic tools if provided
    const tools: Anthropic.Tool[] | undefined = request.tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    }));

    const response = await this.client.messages.create({
      model: request.model || DEFAULT_MODEL,
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature ?? 0,
      system: request.systemMessage,
      messages: messages as Anthropic.MessageParam[],
      ...(tools && tools.length > 0 ? { tools } : {}),
    });

    const content = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    // Extract tool calls from response
    const toolCalls = response.content
      .filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use")
      .map((block) => ({
        id: block.id,
        name: block.name,
        input: block.input as Record<string, unknown>,
      }));

    return {
      content,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      model: response.model,
      stopReason: response.stop_reason as "end_turn" | "tool_use" | "max_tokens" | undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  async *generateStream(
    request: CompletionRequest
  ): AsyncIterable<StreamChunk> {
    const messages = request.messages ?? [
      { role: "user" as const, content: request.userMessage! },
    ];

    // Build Anthropic tools if provided
    const tools: Anthropic.Tool[] | undefined = request.tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    }));

    const stream = this.client.messages.stream({
      model: request.model || DEFAULT_MODEL,
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature ?? 0,
      system: request.systemMessage,
      messages: messages as Anthropic.MessageParam[],
      ...(tools && tools.length > 0 ? { tools } : {}),
    });

    // Track active tool_use blocks: index → { id, name, jsonBuf }
    const activeToolBlocks = new Map<
      number,
      { id: string; name: string; jsonBuf: string }
    >();

    for await (const event of stream) {
      // Text content
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield { type: "text", content: event.delta.text };
      }

      // Tool use: block start
      if (
        event.type === "content_block_start" &&
        event.content_block.type === "tool_use"
      ) {
        activeToolBlocks.set(event.index, {
          id: event.content_block.id,
          name: event.content_block.name,
          jsonBuf: "",
        });
      }

      // Tool use: accumulate JSON input
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "input_json_delta"
      ) {
        const block = activeToolBlocks.get(event.index);
        if (block) {
          block.jsonBuf += event.delta.partial_json;
        }
      }

      // Tool use: block complete
      if (event.type === "content_block_stop") {
        const block = activeToolBlocks.get(event.index);
        if (block) {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(block.jsonBuf || "{}");
          } catch {
            // Malformed JSON — pass empty input
          }
          yield {
            type: "tool_use",
            toolCall: { id: block.id, name: block.name, input },
          };
          activeToolBlocks.delete(event.index);
        }
      }

      // Message delta with stop reason
      if (event.type === "message_delta") {
        const delta = event as unknown as {
          type: "message_delta";
          delta: { stop_reason?: string };
          usage?: { output_tokens?: number };
        };
        const stopReason = delta.delta.stop_reason as
          | "end_turn"
          | "tool_use"
          | "max_tokens"
          | undefined;
        if (stopReason) {
          yield { type: "stop", stopReason };
        }
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
