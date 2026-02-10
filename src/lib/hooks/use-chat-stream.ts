"use client";

import { useState, useCallback, useRef } from "react";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import type { ChatMessage } from "@/types/chat";

interface StreamEvent {
  type: "text" | "usage" | "mapping_update" | "done" | "error";
  content?: string | Record<string, unknown>;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
}

interface UseChatStreamReturn {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
  pendingUpdate: Record<string, unknown> | null;
  sendMessage: (content: string, voiceInput?: boolean) => Promise<void>;
  setMessages: (messages: ChatMessage[]) => void;
}

export function useChatStream(sessionId: string | null): UseChatStreamReturn {
  const { workspaceId } = useWorkspace();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [pendingUpdate, setPendingUpdate] =
    useState<Record<string, unknown> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (content: string, voiceInput?: boolean) => {
      if (!sessionId || isStreaming) return;

      // Add user message to local state
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        sessionId,
        role: "user",
        content,
        metadata: voiceInput ? { voiceInput: true } : null,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);
      setIsStreaming(true);
      setStreamingContent("");
      setPendingUpdate(null);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(
          `/api/workspaces/${workspaceId}/chat-sessions/${sessionId}/messages`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content, voiceInput }),
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
        abortRef.current = null;
      }
    },
    [sessionId, workspaceId, isStreaming]
  );

  return {
    messages,
    isStreaming,
    streamingContent,
    pendingUpdate,
    sendMessage,
    setMessages,
  };
}
