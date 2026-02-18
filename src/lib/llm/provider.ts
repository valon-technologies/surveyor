export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface CompletionRequest {
  systemMessage: string;
  userMessage?: string;
  messages?: Array<{
    role: "user" | "assistant";
    content: string | Array<Record<string, unknown>>;
  }>;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
}

export interface CompletionResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface StreamChunk {
  type: "text" | "tool_use" | "usage" | "stop" | "done" | "error";
  content?: string;
  toolCall?: ToolCall;
  stopReason?: "end_turn" | "tool_use" | "max_tokens";
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
}

export interface LLMProvider {
  name: string;
  generateCompletion(request: CompletionRequest): Promise<CompletionResponse>;
  generateStream(
    request: CompletionRequest
  ): AsyncIterable<StreamChunk>;
  countTokens(text: string, model?: string): Promise<number>;
}
