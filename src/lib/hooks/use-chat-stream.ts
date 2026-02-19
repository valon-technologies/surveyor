"use client";

import { useState, useCallback, useRef } from "react";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import type { ChatMessage } from "@/types/chat";
import type { PipelineStructureUpdate } from "@/types/pipeline";
import type { ForgeClientData } from "@/lib/generation/forge-tools";

export type { ForgeClientData } from "@/lib/generation/forge-tools";

export interface ToolExecution {
  toolName: string;
  purpose: string;
  sql?: string;
  status: "running" | "complete" | "error";
  result?: {
    success: boolean;
    rowCount?: number;
    error?: string;
    durationMs?: number;
    preview?: Record<string, unknown>[];
  };
  forgeData?: ForgeClientData;
}

interface StreamEvent {
  type: "text" | "usage" | "mapping_update" | "entity_mapping_updates" | "pipeline_structure_update" | "skill_update" | "tool_start" | "tool_result" | "done" | "error";
  content?: string | Record<string, unknown> | Record<string, unknown>[];
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
  // tool_start fields
  toolName?: string;
  purpose?: string;
  sql?: string;
  // tool_result fields
  success?: boolean;
  rowCount?: number;
  durationMs?: number;
  preview?: Record<string, unknown>[];
  forgeData?: ForgeClientData;
}

interface SendMessageOptions {
  voiceInput?: boolean;
  kickoff?: boolean;
}

interface UseChatStreamReturn {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
  pendingUpdate: Record<string, unknown> | null;
  pendingEntityUpdates: Record<string, unknown>[] | null;
  pendingPipelineUpdate: PipelineStructureUpdate | null;
  pendingSkillUpdate: Record<string, unknown> | null;
  activeToolCall: ToolExecution | null;
  toolHistory: ToolExecution[];
  forgeToolResults: ToolExecution[];
  sendMessage: (content: string, options?: SendMessageOptions) => Promise<void>;
  setMessages: (messages: ChatMessage[]) => void;
  resetForgeToolResults: () => void;
}

interface UseChatStreamOptions {
  /** API path prefix between workspaceId and sessionId. Default: "chat-sessions" */
  apiPrefix?: string;
}

export function useChatStream(sessionId: string | null, options?: UseChatStreamOptions): UseChatStreamReturn {
  const { workspaceId } = useWorkspace();
  const apiPrefix = options?.apiPrefix || "chat-sessions";
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [pendingUpdate, setPendingUpdate] =
    useState<Record<string, unknown> | null>(null);
  const [pendingEntityUpdates, setPendingEntityUpdates] =
    useState<Record<string, unknown>[] | null>(null);
  const [pendingPipelineUpdate, setPendingPipelineUpdate] =
    useState<PipelineStructureUpdate | null>(null);
  const [pendingSkillUpdate, setPendingSkillUpdate] =
    useState<Record<string, unknown> | null>(null);
  const [activeToolCall, setActiveToolCall] = useState<ToolExecution | null>(null);
  const [toolHistory, setToolHistory] = useState<ToolExecution[]>([]);
  const [forgeToolResults, setForgeToolResults] = useState<ToolExecution[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const resetForgeToolResults = useCallback(() => setForgeToolResults([]), []);

  const sendMessage = useCallback(
    async (content: string, options?: SendMessageOptions) => {
      if (!sessionId || isStreaming) return;

      const { voiceInput, kickoff } = options || {};

      // Add user message to local state (kickoff messages are hidden in the UI)
      const metadata: ChatMessage["metadata"] = {};
      if (voiceInput) metadata.voiceInput = true;
      if (kickoff) metadata.kickoff = true;

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        sessionId,
        role: "user",
        content,
        metadata: Object.keys(metadata).length > 0 ? metadata : null,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);
      setIsStreaming(true);
      setStreamingContent("");
      setPendingUpdate(null);
      setPendingEntityUpdates(null);
      setPendingPipelineUpdate(null);
      setPendingSkillUpdate(null);
      setActiveToolCall(null);
      setToolHistory([]);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(
          `/api/workspaces/${workspaceId}/${apiPrefix}/${sessionId}/messages`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content, voiceInput, kickoff }),
            signal: controller.signal,
          }
        );

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Stream failed" }));
          throw new Error(err.error || "Stream failed");
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";
        let fullContent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (!data) continue;

            try {
              const event: StreamEvent = JSON.parse(data);

              if (event.type === "text" && typeof event.content === "string") {
                fullContent += event.content;
                setStreamingContent(fullContent);
              }

              if (event.type === "mapping_update" && event.content) {
                setPendingUpdate(event.content as Record<string, unknown>);
              }

              if (event.type === "entity_mapping_updates" && event.content) {
                setPendingEntityUpdates(event.content as Record<string, unknown>[]);
              }

              if (event.type === "pipeline_structure_update" && event.content) {
                setPendingPipelineUpdate(event.content as unknown as PipelineStructureUpdate);
              }

              if (event.type === "skill_update" && event.content) {
                setPendingSkillUpdate(event.content as Record<string, unknown>);
              }

              if (event.type === "tool_start") {
                const toolExec: ToolExecution = {
                  toolName: event.toolName || "query_bigquery",
                  purpose: event.purpose || "",
                  sql: event.sql,
                  status: "running",
                };
                setActiveToolCall(toolExec);
              }

              if (event.type === "tool_result") {
                const completed: ToolExecution = {
                  toolName: event.toolName || "query_bigquery",
                  purpose: event.purpose || "",
                  sql: event.sql,
                  status: event.success ? "complete" : "error",
                  result: {
                    success: event.success ?? false,
                    rowCount: event.rowCount,
                    error: event.error,
                    durationMs: event.durationMs,
                    preview: event.preview,
                  },
                  forgeData: event.forgeData,
                };
                setActiveToolCall(completed);
                setToolHistory((prev) => [...prev, completed]);
                // Accumulate forge tool results for persistent cards
                if (event.forgeData) {
                  setForgeToolResults((prev) => [...prev, completed]);
                }
                // Clear active indicator after a short delay
                setTimeout(() => setActiveToolCall(null), 500);
              }

              if (event.type === "done") {
                // Add completed assistant message
                const assistantMessage: ChatMessage = {
                  id: crypto.randomUUID(),
                  sessionId,
                  role: "assistant",
                  content: fullContent,
                  metadata: null,
                  createdAt: new Date().toISOString(),
                };
                setMessages((prev) => [...prev, assistantMessage]);
                setStreamingContent("");
              }

              if (event.type === "error") {
                throw new Error(event.error || "Stream error");
              }
            } catch (e) {
              if (e instanceof SyntaxError) continue; // Skip malformed JSON lines
              throw e;
            }
          }
        }
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          // Add error message
          const errorMessage: ChatMessage = {
            id: crypto.randomUUID(),
            sessionId,
            role: "assistant",
            content: `Error: ${(error as Error).message}`,
            metadata: null,
            createdAt: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, errorMessage]);
          setStreamingContent("");
        }
      } finally {
        setIsStreaming(false);
        setActiveToolCall(null);
        abortRef.current = null;
      }
    },
    [sessionId, workspaceId, apiPrefix, isStreaming]
  );

  return {
    messages,
    isStreaming,
    streamingContent,
    pendingUpdate,
    pendingEntityUpdates,
    pendingPipelineUpdate,
    pendingSkillUpdate,
    activeToolCall,
    toolHistory,
    forgeToolResults,
    sendMessage,
    setMessages,
    resetForgeToolResults,
  };
}
