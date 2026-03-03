"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import { ChatInput } from "@/components/chat/chat-input";
import { ForgeSkillPreviewCard } from "@/components/forge/forge-skill-preview-card";
import { PriorSessionsPanel } from "@/components/chat/prior-sessions-panel";
import {
  useCreateForgeSession,
  useForgeSessions,
  useApplyForgeSkill,
} from "@/queries/forge-queries";
import type { ApplyForgeSkillInput, ApplyForgeSkillResult } from "@/queries/forge-queries";
import { useChatStream } from "@/lib/hooks/use-chat-stream";
import { useChatSession } from "@/queries/chat-queries";
import { ArrowLeft, Hammer } from "lucide-react";

export function ForgeClient() {
  const params = useParams<{ entityName: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const entityName = decodeURIComponent(params.entityName);
  const skillId = searchParams.get("skillId") || undefined;

  const { data: priorSessions, isLoading: loadingSessions } = useForgeSessions(
    entityName,
    skillId
  );
  const createSession = useCreateForgeSession();
  const applySkill = useApplyForgeSkill();

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [viewedPriorSessionId, setViewedPriorSessionId] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const { data: sessionData } = useChatSession(activeSessionId);

  const {
    messages,
    isStreaming,
    streamingContent,
    pendingSkillUpdate,
    activeToolCall,
    forgeToolResults,
    sendMessage,
    setMessages,
    resetForgeToolResults,
  } = useChatStream(activeSessionId, { apiPrefix: "forge-sessions" });

  const [kickoffSent, setKickoffSent] = useState(false);
  const [applied, setApplied] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyForgeSkillResult | null>(null);

  const startNewSession = useCallback(() => {
    setActiveSessionId(null);
    setViewedPriorSessionId(null);
    setKickoffSent(false);
    setMessages([]);
    setApplied(false);
    setApplyResult(null);
    resetForgeToolResults();

    createSession.mutate(
      { entityName, skillId },
      {
        onSuccess: (session) => {
          setActiveSessionId(session.id);
        },
      }
    );
  }, [entityName, skillId, resetForgeToolResults]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-create session once prior sessions load
  useEffect(() => {
    if (initialized || loadingSessions) return;
    setInitialized(true);
    startNewSession();
  }, [loadingSessions, initialized, startNewSession]);

  // Load existing messages when session loads
  useEffect(() => {
    if (sessionData?.messages) {
      setMessages(sessionData.messages);
    }
  }, [sessionData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-send kickoff
  useEffect(() => {
    if (!activeSessionId || kickoffSent || isStreaming) return;
    const hasConversation = messages.some((m) => m.role !== "system");
    if (hasConversation) return;

    setKickoffSent(true);
    const kickoffMsg = skillId
      ? `Review and refine the existing skill for entity "${entityName}". Analyze the current context assignments for signal-to-noise ratio and propose improvements.`
      : `Build a mapping skill for the entity "${entityName}". Start by examining the target fields, then systematically discover and curate the best context bundle.`;

    sendMessage(kickoffMsg, { kickoff: true });
  }, [activeSessionId, messages, kickoffSent, isStreaming]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleApplySkill = () => {
    if (!activeSessionId || !pendingSkillUpdate) return;
    applySkill.mutate(
      {
        sessionId: activeSessionId,
        skill: pendingSkillUpdate as unknown as ApplyForgeSkillInput,
      },
      {
        onSuccess: (result) => {
          setApplied(true);
          setApplyResult(result);
        },
      }
    );
  };

  const handleDismiss = () => {
    setApplied(false);
    setApplyResult(null);
  };

  // Filter current session from prior list
  const displayedPriorSessions = (priorSessions ?? []).filter(
    (s) => s.id !== activeSessionId
  );

  return (
    <div className="flex flex-col h-screen">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push("/context?tab=skills")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2">
            <Hammer className="h-4 w-4 text-purple-500" />
            <span className="font-medium text-sm">
              Forge: {entityName}
              {skillId && (
                <span className="text-muted-foreground ml-1">(refining)</span>
              )}
            </span>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={startNewSession}
          disabled={createSession.isPending || isStreaming}
        >
          New Session
        </Button>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Chat */}
        <div className="flex-1 flex flex-col min-w-0">
          <ChatMessageList
            messages={messages}
            streamingContent={streamingContent}
            isStreaming={isStreaming}
            activeToolCall={activeToolCall}
            forgeToolResults={forgeToolResults}
          />
          <ChatInput
            onSend={sendMessage}
            disabled={isStreaming || !activeSessionId}
          />
        </div>

        {/* Right: Skill preview + prior sessions */}
        <div className="w-80 border-l flex flex-col overflow-y-auto">
          {/* Skill preview card */}
          {pendingSkillUpdate && (
            <ForgeSkillPreviewCard
              skillUpdate={pendingSkillUpdate}
              onApply={handleApplySkill}
              onDismiss={handleDismiss}
              applying={applySkill.isPending}
              applied={applied}
              applyResult={applyResult}
            />
          )}

          {/* Prior sessions */}
          <PriorSessionsPanel
            sessions={displayedPriorSessions}
            viewedSessionId={viewedPriorSessionId}
            onToggle={(id) =>
              setViewedPriorSessionId((prev) =>
                prev === id ? null : id
              )
            }
          />
        </div>
      </div>
    </div>
  );
}
