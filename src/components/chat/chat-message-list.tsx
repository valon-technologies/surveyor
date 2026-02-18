"use client";

import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types/chat";
import type { ToolExecution } from "@/lib/hooks/use-chat-stream";
import { Database, Loader2, CheckCircle2, XCircle } from "lucide-react";

interface ChatMessageListProps {
  messages: ChatMessage[];
  streamingContent: string;
  isStreaming: boolean;
  activeToolCall?: ToolExecution | null;
}

export function ChatMessageList({
  messages,
  streamingContent,
  isStreaming,
  activeToolCall,
}: ChatMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent, activeToolCall]);

  // Filter out system messages and kickoff messages from display
  const visibleMessages = messages.filter(
    (m) => m.role !== "system" && !m.metadata?.kickoff
  );

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {visibleMessages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}

      {isStreaming && streamingContent && (
        <div className="flex gap-3">
          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-xs font-medium text-primary">
            AI
          </div>
          <div className="flex-1 bg-muted rounded-lg px-4 py-3 text-sm">
            <article className="prose prose-sm prose-neutral max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {streamingContent}
              </ReactMarkdown>
            </article>
            <span className="inline-block w-1.5 h-4 bg-primary/60 animate-pulse ml-0.5 align-text-bottom" />
          </div>
        </div>
      )}

      {activeToolCall && (
        <ToolCallIndicator toolCall={activeToolCall} />
      )}

      {isStreaming && !activeToolCall && (
        <div className="flex gap-3 items-center">
          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-xs font-medium text-primary">
            AI
          </div>
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          {streamingContent && (
            <span className="text-xs text-muted-foreground">Working...</span>
          )}
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}

function ToolCallIndicator({ toolCall }: { toolCall: ToolExecution }) {
  const isRunning = toolCall.status === "running";
  const isError = toolCall.status === "error";

  return (
    <div className="flex gap-3">
      <div className="w-7 h-7 rounded-full bg-amber-100 dark:bg-amber-950/50 flex items-center justify-center shrink-0">
        <Database className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
      </div>
      <div className="flex-1 border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 rounded-lg px-4 py-3 text-sm">
        <div className="flex items-center gap-2 mb-1">
          {isRunning && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600" />
          )}
          {!isRunning && !isError && (
            <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
          )}
          {isError && (
            <XCircle className="h-3.5 w-3.5 text-red-500" />
          )}
          <span className="font-medium text-amber-900 dark:text-amber-200">
            {isRunning ? "Querying BigQuery..." : isError ? "Query failed" : "Query complete"}
          </span>
          {toolCall.result?.durationMs != null && (
            <span className="text-xs text-muted-foreground">
              {(toolCall.result.durationMs / 1000).toFixed(1)}s
            </span>
          )}
        </div>
        {toolCall.purpose && (
          <p className="text-xs text-amber-800 dark:text-amber-300 mb-2">
            {toolCall.purpose}
          </p>
        )}
        {toolCall.sql && (
          <pre className="text-xs bg-amber-100/50 dark:bg-amber-950/50 rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap font-mono text-amber-900 dark:text-amber-200">
            {toolCall.sql}
          </pre>
        )}
        {toolCall.result?.rowCount != null && toolCall.result.success && (
          <p className="text-xs text-muted-foreground mt-1">
            {toolCall.result.rowCount} row{toolCall.result.rowCount !== 1 ? "s" : ""} returned
          </p>
        )}
        {toolCall.result?.error && (
          <p className="text-xs text-red-600 mt-1">
            {toolCall.result.error}
          </p>
        )}
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div
      className={cn("flex gap-3", isUser && "flex-row-reverse")}
    >
      <div
        className={cn(
          "w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-medium",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-primary/10 text-primary"
        )}
      >
        {isUser ? "You" : "AI"}
      </div>
      <div
        className={cn(
          "max-w-[80%] rounded-lg px-4 py-3 text-sm",
          isUser
            ? "bg-primary text-primary-foreground whitespace-pre-wrap"
            : "bg-muted"
        )}
      >
        {isUser ? (
          message.content
        ) : (
          <article className="prose prose-sm prose-neutral max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
          </article>
        )}
      </div>
    </div>
  );
}
