export interface CompletionRequest {
  systemMessage: string;
  userMessage: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface CompletionResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface StreamChunk {
  type: "text" | "usage" | "done" | "error";
  content?: string;
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
