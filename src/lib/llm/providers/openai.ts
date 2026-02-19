import OpenAI from "openai";
import type {
  LLMProvider,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  ToolDefinition,
} from "../provider";
import { countTokensTiktoken } from "../token-counter";

const DEFAULT_MODEL = "gpt-4o";

function toOpenAITools(
  tools: ToolDefinition[]
): OpenAI.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as OpenAI.FunctionParameters,
    },
  }));
}

/**
 * Convert our internal message format (which may include Anthropic-style
 * content-block arrays with tool_use / tool_result) into OpenAI's format.
 */
function toOpenAIMessages(
  systemMessage: string,
  messages: Array<{ role: "user" | "assistant"; content: string | Array<Record<string, unknown>> }>
): OpenAI.ChatCompletionMessageParam[] {
  const out: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: systemMessage },
  ];

  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push({ role: m.role, content: m.content });
      continue;
    }

    // Content-block array — may contain text, tool_use, or tool_result blocks
    if (m.role === "assistant") {
      // Build assistant message with optional tool_calls
      let textContent = "";
      const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = [];

      for (const block of m.content) {
        if (block.type === "text") {
          textContent += (block.text as string) || "";
        } else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id as string,
            type: "function",
            function: {
              name: block.name as string,
              arguments: JSON.stringify(block.input),
            },
          });
        }
      }

      out.push({
        role: "assistant",
        content: textContent || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      } as OpenAI.ChatCompletionAssistantMessageParam);
    } else {
      // User turn — may contain tool_result blocks
      for (const block of m.content) {
        if (block.type === "tool_result") {
          out.push({
            role: "tool",
            tool_call_id: block.tool_use_id as string,
            content: typeof block.content === "string" ? block.content : JSON.stringify(block.content),
          });
        } else if (typeof block === "string") {
          out.push({ role: "user", content: block });
        }
      }
    }
  }

  return out;
}

export class OpenAIProvider implements LLMProvider {
  name = "openai";
  private client: OpenAI;

  constructor(apiKey?: string) {
    this.client = new OpenAI(apiKey ? { apiKey } : undefined);
  }

  async generateCompletion(
    request: CompletionRequest
  ): Promise<CompletionResponse> {
    const userMessages = (request.messages ?? [
      { role: "user" as const, content: request.userMessage! },
    ]).map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    }));

    const tools = request.tools?.length ? toOpenAITools(request.tools) : undefined;

    const response = await this.client.chat.completions.create({
      model: request.model || DEFAULT_MODEL,
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature ?? 0,
      messages: [
        { role: "system" as const, content: request.systemMessage },
        ...userMessages,
      ],
      ...(tools ? { tools } : {}),
    });

    const choice = response.choices[0];
    const finishReason = choice?.finish_reason;

    // Map OpenAI finish reasons to our stopReason type
    const stopReason = finishReason === "tool_calls"
      ? "tool_use" as const
      : finishReason === "length"
        ? "max_tokens" as const
        : "end_turn" as const;

    // Extract tool calls if present
    const toolCalls = choice?.message.tool_calls
      ?.filter((tc): tc is OpenAI.ChatCompletionMessageToolCall & { type: "function" } => tc.type === "function")
      .map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>,
      }));

    return {
      content: choice?.message.content || "",
      inputTokens: response.usage?.prompt_tokens || 0,
      outputTokens: response.usage?.completion_tokens || 0,
      model: response.model,
      stopReason,
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  async *generateStream(
    request: CompletionRequest
  ): AsyncIterable<StreamChunk> {
    const messages = request.messages ?? [
      { role: "user" as const, content: request.userMessage! },
    ];

    const openaiMessages = toOpenAIMessages(request.systemMessage, messages);
    const tools = request.tools?.length ? toOpenAITools(request.tools) : undefined;

    const stream = await this.client.chat.completions.create({
      model: request.model || DEFAULT_MODEL,
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature ?? 0,
      messages: openaiMessages,
      stream: true,
      stream_options: { include_usage: true },
      ...(tools ? { tools } : {}),
    });

    // Track active tool calls being streamed (index → accumulated state)
    const activeToolCalls = new Map<
      number,
      { id: string; name: string; argsBuf: string }
    >();

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      const delta = choice?.delta;

      // Text content
      if (delta?.content) {
        yield { type: "text", content: delta.content };
      }

      // Tool call chunks
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!activeToolCalls.has(idx)) {
            activeToolCalls.set(idx, {
              id: tc.id || "",
              name: tc.function?.name || "",
              argsBuf: "",
            });
          }
          const active = activeToolCalls.get(idx)!;
          if (tc.id) active.id = tc.id;
          if (tc.function?.name) active.name = tc.function.name;
          if (tc.function?.arguments) active.argsBuf += tc.function.arguments;
        }
      }

      // Finish reason
      if (choice?.finish_reason === "tool_calls") {
        // Emit all accumulated tool calls
        for (const [, tc] of activeToolCalls) {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(tc.argsBuf || "{}");
          } catch {
            // Malformed JSON — pass empty input
          }
          yield {
            type: "tool_use",
            toolCall: { id: tc.id, name: tc.name, input },
          };
        }
        activeToolCalls.clear();
        yield { type: "stop", stopReason: "tool_use" };
      } else if (choice?.finish_reason === "stop") {
        yield { type: "stop", stopReason: "end_turn" };
      } else if (choice?.finish_reason === "length") {
        yield { type: "stop", stopReason: "max_tokens" };
      }

      // Usage
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
