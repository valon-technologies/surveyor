"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import { ChatInput } from "@/components/chat/chat-input";
import { MappingStateCard } from "@/components/chat/mapping-state-card";
import { PriorSessionsPanel } from "@/components/chat/prior-sessions-panel";
import { SessionCompleteCard } from "@/components/chat/session-complete-card";
import { useMapping, useUpdateMapping } from "@/queries/mapping-queries";
import { useExcludeMapping } from "@/queries/review-queries";
import { useEntity } from "@/queries/entity-queries";
import { useRippleSimilar } from "@/queries/ripple-queries";
import { RipplePanel } from "@/components/review/ripple-panel";
import { SourceVerdictCard } from "@/components/review/source-verdict-card";
import { TransformVerdictCard } from "@/components/review/transform-verdict-card";
import { QuestionFeedbackCard } from "@/components/review/question-feedback-card";
import { useFieldMappingQuestion } from "@/queries/question-queries";
import type { ReviewCardData } from "@/types/review";
import { MAPPING_TYPES, CONFIDENCE_LEVELS, type MappingStatus } from "@/lib/constants";
import {
  useCreateChatSession,
  useChatSession,
  useChatSessionsByMapping,
} from "@/queries/chat-queries";
import { useChatStream } from "@/lib/hooks/use-chat-stream";
import {
  ArrowLeft,
  Ban,
  Zap,
} from "lucide-react";

export function DiscussClient() {
  const params = useParams<{ fieldMappingId: string }>();
  const router = useRouter();
  const fieldMappingId = params.fieldMappingId;

  // Track the "live" mapping ID — follows new versions after Apply (copy-on-write)
  const [activeMappingId, setActiveMappingId] = useState(fieldMappingId);
  const { data: mapping } = useMapping(activeMappingId);
  const { data: priorSessions, isLoading: loadingSessions } =
    useChatSessionsByMapping(fieldMappingId);
  const createSession = useCreateChatSession();
  const updateMapping = useUpdateMapping();
  const excludeMutation = useExcludeMapping();

  const { data: linkedQuestion } = useFieldMappingQuestion(fieldMappingId);

  // Ripple propagation state
  const [showRipple, setShowRipple] = useState(false);
  const [rippleMappingId, setRippleMappingId] = useState<string | null>(null);
  const { data: similarData } = useRippleSimilar(rippleMappingId);

  // Track whether user has applied an update this session
  const [hasApplied, setHasApplied] = useState(false);

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [viewedPriorSessionId, setViewedPriorSessionId] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const { data: sessionData } = useChatSession(activeSessionId);

  const {
    messages,
    isStreaming,
    streamingContent,
    pendingUpdate,
    activeToolCall,
    sendMessage,
    setMessages,
  } = useChatStream(activeSessionId);

  const [kickoffSent, setKickoffSent] = useState(false);

  const startNewSession = useCallback(() => {
    if (!fieldMappingId) return;
    setActiveSessionId(null);
    setViewedPriorSessionId(null);
    setKickoffSent(false);
    setMessages([]);
    setShowRipple(false);
    setRippleMappingId(null);

    createSession.mutate(
      { fieldMappingId },
      {
        onSuccess: (session) => {
          setActiveSessionId(session.id);
        },
      }
    );
  }, [fieldMappingId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-create new session once prior sessions are loaded
  useEffect(() => {
    if (initialized || loadingSessions || !fieldMappingId) return;
    setInitialized(true);
    startNewSession();
  }, [loadingSessions, fieldMappingId, initialized, startNewSession]);

  // Load existing messages when session loads
  useEffect(() => {
    if (sessionData?.messages) {
      setMessages(sessionData.messages);
    }
  }, [sessionData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-send kickoff message to start the conversation
  useEffect(() => {
    if (!activeSessionId || kickoffSent || isStreaming) return;
    // Only kick off if no user/assistant messages exist yet (fresh session)
    const hasConversation = messages.some((m) => m.role !== "system");
    if (hasConversation) return;

    setKickoffSent(true);
    sendMessage(
      "Review this mapping and help me improve it. What questions do you have?",
      { kickoff: true }
    );
  }, [activeSessionId, messages, kickoffSent, isStreaming]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derive mapping state for the right panel
  const mappingState = mapping
    ? {
        mappingType: mapping.mappingType ?? null,
        sourceEntityName: mapping.sourceField?.entityName || null,
        sourceFieldName:
          mapping.sourceField?.displayName ||
          mapping.sourceField?.name ||
          null,
        transform: mapping.transform ?? null,
        defaultValue: mapping.defaultValue ?? null,
        enumMapping: mapping.enumMapping ?? null,
        reasoning: mapping.reasoning ?? null,
        confidence: mapping.confidence ?? null,
        notes: mapping.notes ?? null,
        sourceVerdict: mapping.sourceVerdict ?? null,
        sourceVerdictNotes: mapping.sourceVerdictNotes ?? null,
        transformVerdict: mapping.transformVerdict ?? null,
        transformVerdictNotes: mapping.transformVerdictNotes ?? null,
      }
    : null;

  const targetFieldName =
    mapping?.targetField?.displayName || mapping?.targetField?.name || "Field";
  const entityName =
    mapping?.targetField?.entityName || "Entity";

  // Fetch entity data for sibling field navigation (only after apply)
  const entityId = mapping?.targetField?.entityId;
  const { data: entityData } = useEntity(hasApplied ? entityId : undefined);

  // Build sibling navigation data
  const siblingNav = useMemo(() => {
    if (!entityData?.fields || !mapping?.targetField?.id) return null;

    const currentFieldId = mapping.targetField.id;
    const siblings = entityData.fields.filter((f) => f.id !== currentFieldId);

    // Prioritize: unmapped first, then pending/low-confidence, skip accepted/excluded
    const actionable = siblings
      .filter((f) => {
        const status = f.mapping?.status ?? "unmapped";
        return status !== "accepted" && status !== "excluded";
      })
      .sort((a, b) => {
        const aStatus = a.mapping?.status ?? "unmapped";
        const bStatus = b.mapping?.status ?? "unmapped";
        const priority: Record<string, number> = {
          unmapped: 0,
          needs_discussion: 1,
          punted: 2,
          unreviewed: 3,
        };
        return (priority[aStatus] ?? 9) - (priority[bStatus] ?? 9);
      })
      .slice(0, 4);

    const completedCount = entityData.fields.filter(
      (f) => f.mapping?.status === "accepted" || f.mapping?.status === "excluded"
    ).length;

    return {
      totalFields: entityData.fields.length,
      completedFields: completedCount,
      nextFields: actionable.map((f) => ({
        fieldName: f.displayName || f.name,
        dataType: f.dataType,
        mappingId: f.mapping?.id ?? null,
        status: (f.mapping?.status ?? "unmapped") as MappingStatus | "unmapped",
        confidence: f.mapping?.confidence ?? null,
      })),
    };
  }, [entityData, mapping?.targetField?.id]);

  const handleApplyUpdate = (update: Record<string, unknown>) => {
    if (!activeMappingId) return;
    // Sanitize LLM-produced values: strip display-only keys and coerce invalid enums
    const { sourceEntityName, sourceFieldName, ...patchData } = update;
    if (patchData.mappingType && !MAPPING_TYPES.includes(patchData.mappingType as typeof MAPPING_TYPES[number])) {
      console.warn(`[discuss] Unknown mappingType "${patchData.mappingType}", coercing to "derived"`);
      patchData.mappingType = "derived";
    }
    if (patchData.confidence && !CONFIDENCE_LEVELS.includes(patchData.confidence as typeof CONFIDENCE_LEVELS[number])) {
      console.warn(`[discuss] Unknown confidence "${patchData.confidence}", coercing to "medium"`);
      patchData.confidence = "medium";
    }
    updateMapping.mutate(
      { id: activeMappingId, status: "accepted", ...patchData },
      {
        onSuccess: (newVersion) => {
          // Copy-on-write creates a new record — follow the new ID
          setActiveMappingId(newVersion.id);
          // Trigger ripple similarity check
          setRippleMappingId(newVersion.id);
          setShowRipple(false);
          // Show session complete navigation
          setHasApplied(true);
        },
      }
    );
  };

  // Filter out the current active session from "prior" list
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
          <div>
            <span className="font-medium text-sm">{targetFieldName}</span>
            {mapping?.targetField?.dataType && (
              <span className="text-xs text-muted-foreground ml-2">
                {mapping.targetField.dataType}
              </span>
            )}
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            excludeMutation.mutate({ mappingId: activeMappingId }, {
              onSuccess: () => router.push("/mapping"),
            })
          }
          disabled={excludeMutation.isPending}
          className="text-muted-foreground hover:text-destructive hover:border-destructive"
        >
          <Ban className="h-3.5 w-3.5 mr-1" />
          Exclude
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

        {/* Right: Mapping state + prior sessions + ripple suggestion */}
        <div className="w-80 border-l flex flex-col overflow-y-auto">
          {mappingState && (
            <MappingStateCard
              targetFieldName={targetFieldName}
              entityName={entityName}
              mapping={mappingState}
              pendingUpdate={pendingUpdate}
              onApplyUpdate={handleApplyUpdate}
              applied={hasApplied}
            />
          )}

          {/* Feedback verdict cards */}
          {mappingState && (
            <SourceVerdictCard
              mappingId={fieldMappingId}
              sourceEntityName={mappingState.sourceEntityName ?? null}
              sourceFieldName={mappingState.sourceFieldName ?? null}
              initialVerdict={mappingState.sourceVerdict ?? null}
              initialNotes={mappingState.sourceVerdictNotes ?? null}
            />
          )}

          {mappingState &&
            (mappingState.transform ||
              (mappingState.mappingType && mappingState.mappingType !== "direct")) && (
            <TransformVerdictCard
              mappingId={fieldMappingId}
              mappingType={mappingState.mappingType ?? null}
              transform={mappingState.transform ?? null}
              initialVerdict={mappingState.transformVerdict ?? null}
              initialNotes={mappingState.transformVerdictNotes ?? null}
            />
          )}

          {linkedQuestion && (
            <QuestionFeedbackCard
              questionId={linkedQuestion.id}
              questionText={linkedQuestion.question}
              initialHelpful={linkedQuestion.feedbackHelpful ?? null}
              initialWhyNot={linkedQuestion.feedbackWhyNot ?? null}
              initialBetterQuestion={linkedQuestion.feedbackBetterQuestion ?? null}
            />
          )}

          {/* Prior sessions panel */}
          <PriorSessionsPanel
            sessions={displayedPriorSessions}
            viewedSessionId={viewedPriorSessionId}
            onToggle={(id) =>
              setViewedPriorSessionId((prev) => (prev === id ? null : id))
            }
          />

          {/* Ripple suggestion after Apply */}
          {similarData && similarData.similar.length > 0 && !showRipple && (
            <div className="mx-3 mb-3 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
              <div className="flex items-center gap-2 text-sm">
                <Zap className="h-4 w-4 text-amber-500" />
                <span className="font-medium">
                  {similarData.similar.length} similar field
                  {similarData.similar.length !== 1 ? "s" : ""} found
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                This mapping pattern may apply to other fields
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowRipple(true)}
                className="mt-2"
              >
                <Zap className="h-3.5 w-3.5 mr-1" />
                Propagate to similar fields
              </Button>
            </div>
          )}

          {/* Session complete navigation after Apply */}
          {hasApplied && siblingNav && (
            <SessionCompleteCard
              entityName={entityName}
              totalFields={siblingNav.totalFields}
              completedFields={siblingNav.completedFields}
              nextFields={siblingNav.nextFields}
              onNavigateToField={(mappingId) =>
                router.push(`/mapping/discuss/${mappingId}`)
              }
              onBackToQueue={() => router.push("/mapping")}
            />
          )}
        </div>

        {/* Ripple panel (sheet overlay) */}
        {showRipple && activeMappingId && mapping && (
          <RipplePanel
            card={
              {
                id: activeMappingId,
                targetFieldId: mapping.targetField?.id || "",
                targetFieldName:
                  mapping.targetField?.displayName ||
                  mapping.targetField?.name ||
                  "",
                targetFieldDescription: null,
                targetFieldDataType: mapping.targetField?.dataType || null,
                milestone: null,
                entityId: mapping.targetField?.entityId || "",
                entityName:
                  mapping.targetField?.entityName || entityName,
                parentEntityId: null,
                parentEntityName: null,
                status: mapping.status,
                mappingType: mapping.mappingType ?? null,
                confidence: mapping.confidence ?? null,
                sourceEntityId: mapping.sourceEntityId ?? null,
                sourceFieldId: mapping.sourceFieldId ?? null,
                sourceEntityName:
                  mapping.sourceField?.entityName ?? null,
                sourceFieldName: mapping.sourceField?.name ?? null,
                transform: mapping.transform ?? null,
                defaultValue: mapping.defaultValue ?? null,
                reasoning: mapping.reasoning ?? null,
                reviewComment: mapping.notes ?? null,
                notes: mapping.notes ?? null,
                puntNote: null,
                excludeReason: null,
                assigneeId: null,
                assigneeName: null,
                createdBy: mapping.createdBy || "",
                batchRunId: null,
                createdAt: mapping.createdAt || "",
              } satisfies ReviewCardData
            }
            onClose={() => {
              setShowRipple(false);
              setRippleMappingId(null);
            }}
          />
        )}
      </div>
    </div>
  );
}
