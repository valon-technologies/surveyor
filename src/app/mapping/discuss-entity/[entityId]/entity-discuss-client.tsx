"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import { ChatInput } from "@/components/chat/chat-input";
import { EntityMappingOverviewCard } from "@/components/chat/entity-mapping-overview-card";
import { EntityUpdateReviewPanel } from "@/components/chat/entity-update-review-panel";
import { PipelineStructureReviewPanel } from "@/components/chat/pipeline-structure-review-panel";
import { PriorSessionsPanel } from "@/components/chat/prior-sessions-panel";
import { useEntity } from "@/queries/entity-queries";
import {
  useCreateEntityChatSession,
  useEntityChatSessions,
  useApplyEntityUpdates,
  useApplyPipelineUpdate,
} from "@/queries/chat-queries";
import { useChatStream } from "@/lib/hooks/use-chat-stream";
import { useChatSession } from "@/queries/chat-queries";
import type { EntityMappingUpdate } from "@/types/chat";
import type { PipelineStructureUpdate } from "@/types/pipeline";
import { ArrowLeft, MessageSquare } from "lucide-react";

export function EntityDiscussClient() {
  const params = useParams<{ entityId: string }>();
  const router = useRouter();
  const entityId = params.entityId;

  const { data: entityData } = useEntity(entityId);
  const { data: priorSessions, isLoading: loadingSessions } =
    useEntityChatSessions(entityId);
  const createSession = useCreateEntityChatSession();
  const applyUpdates = useApplyEntityUpdates();
  const applyPipeline = useApplyPipelineUpdate();

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [viewedPriorSessionId, setViewedPriorSessionId] = useState<
    string | null
  >(null);
  const [initialized, setInitialized] = useState(false);
  const { data: sessionData } = useChatSession(activeSessionId);

  const {
    messages,
    isStreaming,
    streamingContent,
    pendingEntityUpdates,
    pendingPipelineUpdate,
    activeToolCall,
    sendMessage,
    setMessages,
  } = useChatStream(activeSessionId);

  const [kickoffSent, setKickoffSent] = useState(false);
  const [applied, setApplied] = useState(false);
  const [applyResult, setApplyResult] = useState<{
    applied: number;
    errors: string[];
  } | null>(null);
  const [pipelineApplied, setPipelineApplied] = useState(false);
  const [pipelineApplyResult, setPipelineApplyResult] = useState<{
    success: boolean;
    changes: string[];
  } | null>(null);

  const startNewSession = useCallback(() => {
    if (!entityId) return;
    setActiveSessionId(null);
    setViewedPriorSessionId(null);
    setKickoffSent(false);
    setMessages([]);
    setApplied(false);
    setApplyResult(null);
    setPipelineApplied(false);
    setPipelineApplyResult(null);

    createSession.mutate(
      { entityId },
      {
        onSuccess: (session) => {
          setActiveSessionId(session.id);
        },
      }
    );
  }, [entityId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-create session once prior sessions load
  useEffect(() => {
    if (initialized || loadingSessions || !entityId) return;
    setInitialized(true);
    startNewSession();
  }, [loadingSessions, entityId, initialized, startNewSession]);

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
    sendMessage(
      "Review the overall mapping strategy for this entity. Summarize the current state and identify the most impactful improvements.",
      { kickoff: true }
    );
  }, [activeSessionId, messages, kickoffSent, isStreaming]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build field summaries for the overview card
  const fieldSummaries = useMemo(() => {
    if (!entityData?.fields) return [];
    return entityData.fields.map((f) => ({
      name: f.displayName || f.name,
      dataType: f.dataType,
      mappingStatus: f.mapping
        ? `${f.mapping.status} (${f.mapping.confidence || "unknown"})`
        : "unmapped",
      sourceInfo: f.mapping?.sourceEntityName && f.mapping?.sourceFieldName
        ? `${f.mapping.sourceEntityName}.${f.mapping.sourceFieldName}`
        : f.mapping?.sourceEntityName || null,
      confidence: f.mapping?.confidence ?? null,
    }));
  }, [entityData?.fields]);

  const handleApplyUpdates = (selectedUpdates: EntityMappingUpdate[]) => {
    if (!activeSessionId) return;
    applyUpdates.mutate(
      { sessionId: activeSessionId, updates: selectedUpdates },
      {
        onSuccess: (result) => {
          setApplied(true);
          setApplyResult(result);
        },
      }
    );
  };

  const handleDismissUpdates = () => {
    // The updates remain in chat history but the review panel hides
    setApplied(false);
    setApplyResult(null);
  };

  const handleApplyPipelineUpdate = () => {
    if (!activeSessionId || !pendingPipelineUpdate) return;
    applyPipeline.mutate(
      { sessionId: activeSessionId, update: pendingPipelineUpdate },
      {
        onSuccess: (result) => {
          setPipelineApplied(true);
          setPipelineApplyResult(result);
        },
      }
    );
  };

  const handleDismissPipelineUpdate = () => {
    setPipelineApplied(false);
    setPipelineApplyResult(null);
  };

  const entityName =
    entityData?.displayName || entityData?.name || "Entity";

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
            onClick={() => router.push("/mapping")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-sm">
              Entity Discussion: {entityName}
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
          />
          <ChatInput
            onSend={sendMessage}
            disabled={isStreaming || !activeSessionId}
          />
        </div>

        {/* Right: Entity overview + update review */}
        <div className="w-80 border-l flex flex-col overflow-y-auto">
          <EntityMappingOverviewCard
            entityName={entityName}
            entityDescription={entityData?.description ?? null}
            fields={fieldSummaries}
          />

          {/* Pipeline structure review panel */}
          {pendingPipelineUpdate && (
            <PipelineStructureReviewPanel
              update={pendingPipelineUpdate}
              onApply={handleApplyPipelineUpdate}
              onDismiss={handleDismissPipelineUpdate}
              applying={applyPipeline.isPending}
              applied={pipelineApplied}
              applyResult={pipelineApplyResult}
            />
          )}

          {/* Entity update review panel */}
          {pendingEntityUpdates && pendingEntityUpdates.length > 0 && (
            <EntityUpdateReviewPanel
              updates={pendingEntityUpdates}
              onApply={handleApplyUpdates}
              onDismiss={handleDismissUpdates}
              applying={applyUpdates.isPending}
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
