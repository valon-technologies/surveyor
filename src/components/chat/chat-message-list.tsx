"use client";

import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types/chat";
import type { ToolExecution } from "@/lib/hooks/use-chat-stream";
import { Database, Loader2, CheckCircle2, XCircle, Hammer } from "lucide-react";
import { ForgeToolResultCard } from "@/components/forge/forge-tool-result-card";

const FORGE_TOOL_NAMES = new Set([
  "search_contexts",
  "browse_contexts",
  "read_context",
  "list_target_fields",
  "get_existing_skill",
  "list_skills",
  "get_mapping_feedback",
]);

interface ChatMessageListProps {
  messages: ChatMessage[];
  streamingContent: string;
  isStreaming: boolean;
  activeToolCall?: ToolExecution | null;
  forgeToolResults?: ToolExecution[];
}

export function ChatMessageList({
  messages,
  streamingContent,
  isStreaming,
  activeToolCall,
  forgeToolResults,
}: ChatMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent, activeToolCall, forgeToolResults?.length]);

  // Filter out system messages and kickoff messages from display
  const visibleMessages = messages.filter(
    (m) => m.role !== "system" && !m.metadata?.kickoff
  );

  const isForgeToolActive =
    activeToolCall && FORGE_TOOL_NAMES.has(activeToolCall.toolName);
  const isNonForgeToolActive =
    activeToolCall && !FORGE_TOOL_NAMES.has(activeToolCall.toolName);

  return (
    <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
      {visibleMessages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}

      {/* Persistent forge tool result cards */}
      {forgeToolResults && forgeToolResults.length > 0 && (
        <div className="space-y-2">
          {forgeToolResults.map((result, i) => (
            <ForgeToolResultCard key={`forge-${i}`} toolResult={result} />
          ))}
        </div>
      )}

      {isStreaming && streamingContent && (
        <div className="text-xs py-1">
          <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">AI</span>
          <div className="mt-0.5">
            <article className="prose prose-sm prose-neutral text-xs max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {streamingContent}
              </ReactMarkdown>
            </article>
            <span className="inline-block w-1.5 h-4 bg-primary/60 animate-pulse ml-0.5 align-text-bottom" />
          </div>
        </div>
      )}

      {/* Forge tool active indicator (slate) */}
      {isForgeToolActive && activeToolCall.status === "running" && (
        <ForgeToolRunningIndicator toolCall={activeToolCall} />
      )}

      {/* Non-forge tool indicator (amber BigQuery style) */}
      {isNonForgeToolActive && (
        <ToolCallIndicator toolCall={activeToolCall} />
      )}

      {isStreaming && !activeToolCall && (
        <div className="flex items-center gap-2 py-1">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Thinking...</span>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}

function ForgeToolRunningIndicator({ toolCall }: { toolCall: ToolExecution }) {
  return (
    <div className="flex gap-3">
      <div className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-800/50 flex items-center justify-center shrink-0">
        <Hammer className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
      </div>
      <div className="flex-1 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/30 rounded-lg px-4 py-3 text-sm">
        <div className="flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />
          <span className="font-medium text-foreground">
            {toolCall.toolName === "search_contexts"
              ? "Searching contexts..."
              : toolCall.toolName === "browse_contexts"
                ? "Browsing contexts..."
                : toolCall.toolName === "read_context"
                  ? "Reading context..."
                  : toolCall.toolName === "list_skills"
                    ? "Listing skills..."
                    : toolCall.toolName === "get_existing_skill"
                      ? "Reading skill..."
                      : toolCall.toolName === "list_target_fields"
                        ? "Listing fields..."
                        : toolCall.toolName === "get_mapping_feedback"
                          ? "Getting feedback..."
                          : "Working..."}
          </span>
        </div>
        {toolCall.purpose && (
          <p className="text-xs text-muted-foreground mt-1">
            {toolCall.purpose}
          </p>
        )}
      </div>
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
    <div className={cn("text-xs", isUser ? "border-l-2 border-primary/40 pl-3 py-1" : "py-1")}>
      <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
        {isUser ? "You" : "AI"}
      </span>
      <div className={cn("mt-0.5", isUser && "text-muted-foreground")}>
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <article className="prose prose-sm prose-neutral text-xs max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
          </article>
        )}
      </div>
    </div>
  );
}
