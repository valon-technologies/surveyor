"use client";

import { useState } from "react";
import { useChatSession } from "@/queries/chat-queries";
import type { ChatSession, ChatMessage } from "@/types/chat";
import { ChevronDown, ChevronRight, Clock } from "lucide-react";

interface PriorSessionsPanelProps {
  sessions: ChatSession[];
  viewedSessionId: string | null;
  onToggle: (sessionId: string) => void;
}

export function PriorSessionsPanel({
  sessions,
  viewedSessionId,
  onToggle,
}: PriorSessionsPanelProps) {
  if (sessions.length === 0) return null;

  return (
    <div className="border-t">
      <div className="px-4 py-2.5 flex items-center gap-2">
        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
        <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          Prior Sessions
        </h4>
        <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">
          {sessions.length}
        </span>
      </div>
      <div className="px-3 pb-3 space-y-1.5">
        {sessions.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            isExpanded={viewedSessionId === session.id}
            onToggle={() => onToggle(session.id)}
          />
        ))}
      </div>
    </div>
  );
}

function SessionCard({
  session,
  isExpanded,
  onToggle,
}: {
  session: ChatSession;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border rounded-md overflow-hidden bg-background">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full text-left px-3 py-2 text-xs hover:bg-accent/50 transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
        )}
        <span className="text-muted-foreground min-w-[4.5rem]">
          {new Date(session.createdAt).toLocaleDateString()}
        </span>
        <span className="truncate">
          {session.createdByName || "Unknown"}
        </span>
        <span className="text-muted-foreground ml-auto shrink-0">
          {session.messageCount} msgs
        </span>
      </button>
      {isExpanded && <SessionSummary sessionId={session.id} />}
    </div>
  );
}

function SessionSummary({ sessionId }: { sessionId: string }) {
  const { data, isLoading } = useChatSession(sessionId);

  if (isLoading) {
    return (
      <div className="px-3 pb-3 pt-1">
        <p className="text-[11px] text-muted-foreground animate-pulse">
          Loading session...
        </p>
      </div>
    );
  }

  const messages = data?.messages ?? [];

  // Extract mapping updates from messages
  const mappingUpdates = messages
    .filter((m) => m.metadata?.mappingUpdate)
    .map((m) => m.metadata!.mappingUpdate!);

  // Get non-kickoff assistant messages for key discussion points
  const assistantMessages = messages.filter(
    (m) => m.role === "assistant" && !m.metadata?.kickoff
  );
  const keyPoints = assistantMessages
    .slice(-3)
    .map((m) => truncate(m.content, 150));

  const hasContent = mappingUpdates.length > 0 || keyPoints.length > 0;

  return (
    <div className="px-3 pb-3 pt-1 space-y-2.5 border-t bg-muted/20">
      {mappingUpdates.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Mapping Updates
          </p>
          <div className="space-y-1">
            {mappingUpdates.map((update, i) => (
              <MappingUpdateSummary key={i} update={update} />
            ))}
          </div>
        </div>
      )}

      {keyPoints.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Key Points
          </p>
          <div className="space-y-1">
            {keyPoints.map((text, i) => (
              <p
                key={i}
                className="text-[11px] text-muted-foreground leading-relaxed"
              >
                {text}
              </p>
            ))}
          </div>
        </div>
      )}

      {!hasContent && (
        <p className="text-[11px] text-muted-foreground italic">
          No mapping changes discussed
        </p>
      )}
    </div>
  );
}

function MappingUpdateSummary({
  update,
}: {
  update: Record<string, unknown>;
}) {
  const parts: string[] = [];
  if (update.sourceEntityName || update.sourceFieldName) {
    parts.push(
      `Source: ${update.sourceEntityName || "?"}. ${update.sourceFieldName || "?"}`
    );
  }
  if (update.mappingType) {
    parts.push(`Type: ${String(update.mappingType)}`);
  }
  if (update.transform) {
    parts.push(`Transform: ${truncate(String(update.transform), 80)}`);
  }
  if (update.confidence) {
    parts.push(`Confidence: ${String(update.confidence)}`);
  }
  if (parts.length === 0) {
    parts.push("Update applied");
  }

  return (
    <div className="text-[11px] bg-blue-50 dark:bg-blue-950/30 px-2 py-1 rounded text-blue-700 dark:text-blue-300">
      {parts.join(" · ")}
    </div>
  );
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + "...";
}
