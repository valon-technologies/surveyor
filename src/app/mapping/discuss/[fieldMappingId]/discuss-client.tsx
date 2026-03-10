"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import { ChatInput } from "@/components/chat/chat-input";
import { MappingSummary } from "@/components/chat/mapping-state-card";
import { PriorSessionsPanel } from "@/components/chat/prior-sessions-panel";
import { SessionCompleteCard } from "@/components/chat/session-complete-card";
import { useMapping, useUpdateMapping } from "@/queries/mapping-queries";
import { useExcludeMapping, usePuntMapping } from "@/queries/review-queries";
import { useEntity } from "@/queries/entity-queries";
import { useRippleSimilar } from "@/queries/ripple-queries";
import { RipplePanel } from "@/components/review/ripple-panel";
import { SourceVerdictCard } from "@/components/review/source-verdict-card";
import { TransformVerdictCard } from "@/components/review/transform-verdict-card";
import { QuestionFeedbackCard } from "@/components/review/question-feedback-card";
import { CreateQuestionCard } from "@/components/review/create-question-card";
import { MappingHistoryPanel } from "@/components/transfer/mapping-history-panel";
import { useFieldMappingQuestion, useResolveQuestion } from "@/queries/question-queries";
import type { ReviewCardData } from "@/types/review";
import { MAPPING_TYPES, CONFIDENCE_LEVELS, type MappingStatus } from "@/lib/constants";
import { cn } from "@/lib/utils";
import {
  useCreateChatSession,
  useChatSession,
  useChatSessionsByMapping,
} from "@/queries/chat-queries";
import { useChatStream } from "@/lib/hooks/use-chat-stream";
import {
  ArrowLeft,
  Ban,
  SkipForward,
  Zap,
} from "lucide-react";
import { CitationMarkdown } from "@/components/context/citation-markdown";
import { ContextUsedPanel } from "@/components/review/context-used-panel";
import { useReviewAnalytics } from "@/lib/analytics/use-review-analytics";

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
  const puntMutation = usePuntMapping();
  const [showPuntDialog, setShowPuntDialog] = useState(false);
  const [puntNote, setPuntNote] = useState("");

  const { data: linkedQuestion } = useFieldMappingQuestion(fieldMappingId);

  // Ripple propagation state
  const [showRipple, setShowRipple] = useState(false);
  const [rippleMappingId, setRippleMappingId] = useState<string | null>(null);
  const { data: similarData } = useRippleSimilar(rippleMappingId);

  // Track whether user has applied an update this session
  const [hasApplied, setHasApplied] = useState(false);
  const notesRef = useRef<HTMLTextAreaElement>(null);

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

  // Analytics tracking for the review session
  const {
    trackSubmitted,
    trackSuggestionAccepted,
    trackSuggestionOverridden,
    trackWhyWrongProvided,
    trackChatSent,
    trackChatChangedMind,
  } = useReviewAnalytics(fieldMappingId, mapping?.targetField?.entityId);

  const [kickoffSent, setKickoffSent] = useState(false);

  // Pre-generated AI review (loaded from DB, overridden by live chat)
  const aiReview = (mapping as any)?.aiReview as {
    proposedUpdate: Record<string, unknown> | null;
    reviewText: string;
    generatedAt: string;
  } | null | undefined;

  // Effective proposed update: live chat overrides pre-generated
  const effectiveUpdate = pendingUpdate ?? aiReview?.proposedUpdate ?? null;
  // AI has reviewed this field (even if it confirms current with no changes)
  const aiHasReviewed = !!pendingUpdate || !!aiReview;

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
  // Skip if a pre-generated AI review already exists — reviewer can chat on demand
  useEffect(() => {
    if (!activeSessionId || kickoffSent || isStreaming) return;
    if (aiReview?.reviewText) return; // Pre-generated review available, don't auto-kick
    // Only kick off if no user/assistant messages exist yet (fresh session)
    const hasConversation = messages.some((m) => m.role !== "system");
    if (hasConversation) return;

    setKickoffSent(true);
    sendMessage(
      "Review this mapping and help me improve it. What questions do you have?",
      { kickoff: true }
    );
  }, [activeSessionId, messages, kickoffSent, isStreaming, aiReview]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Review completion tracking
  const [sourceDecision, setSourceDecision] = useState<string | null>(mappingState?.sourceVerdict ?? null);
  const [transformDecision, setTransformDecision] = useState<string | null>(mappingState?.transformVerdict ?? null);
  const [questionDecision, setQuestionDecision] = useState<boolean>(false);
  const [reviewSubmitted, setReviewSubmitted] = useState(false);
  const [suggestionKey, setSuggestionKey] = useState(0);

  // Reset checkbox state when AI proposes a new update (live or pre-generated)
  useEffect(() => {
    if (effectiveUpdate && !hasApplied) {
      setSourceDecision(null);
      setTransformDecision(null);
      setQuestionDecision(false);
      setSuggestionKey((k) => k + 1);
    }
  }, [effectiveUpdate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-resolve question decision when there's no linked question and no AI suggestion
  // This unblocks submit for transfer mappings and fields without questions
  useEffect(() => {
    if (!linkedQuestion && !effectiveUpdate?.question && !questionDecision) {
      setQuestionDecision(true);
    }
  }, [linkedQuestion, effectiveUpdate, questionDecision]);

  // Fetch entity data for sibling field navigation
  const entityId = mapping?.targetField?.entityId;
  const { data: entityData } = useEntity(entityId);

  // Build sibling navigation data
  const siblingNav = useMemo(() => {
    if (!entityData?.fields || !mapping?.targetField?.id) return null;

    const currentFieldId = mapping.targetField.id;
    const currentTransferId = mapping.transferId ?? null;

    // Filter siblings to same transfer (or same non-transfer context)
    const siblings = entityData.fields.filter((f) => {
      if (f.id === currentFieldId) return false;
      const fTransferId = f.mapping?.transferId ?? null;
      return fTransferId === currentTransferId;
    });

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
          setHasApplied(true);
        },
      }
    );
  };

  // Promote a chat answer to resolve the linked question
  const resolveQuestion = useResolveQuestion();
  const handlePromoteAnswer = useCallback((content: string) => {
    if (!linkedQuestion?.id) return;
    resolveQuestion.mutate(
      { id: linkedQuestion.id, body: content },
      { onSuccess: () => setQuestionDecision(true) },
    );
  }, [linkedQuestion?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
            onClick={() => {
              if (window.history.length > 1) {
                router.back();
              } else {
                const tid = mapping?.transferId;
                router.push(tid ? `/transfers/${tid}/review` : "/mapping");
              }
            }}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{entityName}.{targetFieldName}</span>
            {mapping?.confidence && (
              <span className={cn(
                "text-[10px] font-semibold px-1.5 py-0.5 rounded",
                mapping.confidence === "high" && "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400",
                mapping.confidence === "medium" && "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
                mapping.confidence === "low" && "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
              )}>
                {mapping.confidence} confidence
              </span>
            )}
            {mapping?.targetField?.dataType && (
              <span className="text-xs text-muted-foreground">
                {mapping.targetField.dataType}
              </span>
            )}
            {mapping?.targetField?.description && (
              <span className="text-xs text-muted-foreground truncate max-w-[400px]"
                    title={mapping.targetField.description}>
                — {mapping.targetField.description}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const next = siblingNav?.nextFields?.[0];
              if (next?.mappingId) {
                router.push(`/mapping/discuss/${next.mappingId}`);
              } else {
                router.back();
              }
            }}
            className="text-muted-foreground"
            title="Skip — come back to this field later"
          >
            Skip
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowPuntDialog(true)}
            className="text-muted-foreground hover:text-amber-600 hover:border-amber-400"
          >
            <SkipForward className="h-3.5 w-3.5 mr-1" />
            Punt
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              excludeMutation.mutate({ mappingId: activeMappingId }, {
                onSuccess: () => {
                  const tid = mapping?.transferId;
                  router.push(tid ? `/transfers/${tid}/review` : "/mapping");
                },
              })
            }
            disabled={excludeMutation.isPending}
            className="text-muted-foreground hover:text-destructive hover:border-destructive"
          >
            <Ban className="h-3.5 w-3.5 mr-1" />
            Exclude
          </Button>
        </div>
      </div>

      {/* Main content — single scrollable area */}
      <div className="flex-1 overflow-y-auto">
        {/* Row 1: Current mapping (full width) */}
        <div className="border-b bg-muted/20">
          {mappingState ? (
            <MappingSummary targetFieldName={targetFieldName} mapping={mappingState} />
          ) : (
            <div className="px-4 py-2 text-xs text-muted-foreground">Loading mapping...</div>
          )}
        </div>

        {/* Context used panel — collapsible, shows docs that informed this mapping */}
        <div>
          <ContextUsedPanel mappingId={activeMappingId} reasoning={mapping?.reasoning} />
        </div>

        {/* Row 2: Source | Transform | Question — with layered AI proposals */}
        <div>
          <div className="grid grid-cols-3 divide-x divide-blue-200 dark:divide-blue-800 bg-blue-50 dark:bg-blue-950/40 min-h-full">
            {/* Source column */}
            <div className="flex flex-col">
              {mappingState && (
                <SourceVerdictCard
                  key={`source-${suggestionKey}`}
                  mappingId={fieldMappingId}
                  sourceEntityName={mappingState.sourceEntityName ?? null}
                  sourceFieldName={mappingState.sourceFieldName ?? null}
                  initialVerdict={mappingState.sourceVerdict ?? null}
                  initialNotes={mappingState.sourceVerdictNotes ?? null}
                  onVerdictChange={(v) => {
                    setSourceDecision(v);
                    if (v === "correct" && aiHasReviewed) trackSuggestionAccepted("source");
                    if (v === "wrong") trackSuggestionOverridden("source");
                    if (messages.some((m) => m.role === "user" && !m.metadata?.kickoff)) trackChatChangedMind();
                  }}
                  suggestedSource={effectiveUpdate?.sourceEntityName
                    ? `${effectiveUpdate.sourceEntityName}.${effectiveUpdate.sourceFieldName || "?"}`
                    : effectiveUpdate?.sourceFieldName ? String(effectiveUpdate.sourceFieldName) : null}
                  onAcceptSuggestion={() => trackSuggestionAccepted("source")}
                  suggestionApplied={hasApplied}
                  aiHasOpinion={aiHasReviewed}
                  onWhyWrongProvided={() => trackWhyWrongProvided("source")}
                />
              )}
            </div>

            {/* Transform column */}
            <div className="flex flex-col">
              {mappingState && (
                <TransformVerdictCard
                  key={`transform-${suggestionKey}`}
                  mappingId={fieldMappingId}
                  mappingType={mappingState.mappingType ?? null}
                  transform={mappingState.transform ?? null}
                  initialVerdict={mappingState.transformVerdict ?? null}
                  initialNotes={mappingState.transformVerdictNotes ?? null}
                  onVerdictChange={(v) => {
                    setTransformDecision(v);
                    if (v === "correct" && aiHasReviewed) trackSuggestionAccepted("transform");
                    if (v === "wrong") trackSuggestionOverridden("transform");
                    if (messages.some((m) => m.role === "user" && !m.metadata?.kickoff)) trackChatChangedMind();
                  }}
                  suggestedTransform={effectiveUpdate?.transform ? String(effectiveUpdate.transform) : null}
                  suggestedMappingType={effectiveUpdate?.mappingType ? String(effectiveUpdate.mappingType) : null}
                  onAcceptSuggestion={() => trackSuggestionAccepted("transform")}
                  suggestionApplied={hasApplied}
                  aiHasOpinion={aiHasReviewed}
                  onWhyWrongProvided={() => trackWhyWrongProvided("transform")}
                />
              )}
            </div>

            {/* Question column */}
            <div className="flex flex-col">
              {linkedQuestion ? (
                <QuestionFeedbackCard
                  questionId={linkedQuestion.id}
                  questionText={linkedQuestion.question}
                  initialHelpful={linkedQuestion.feedbackHelpful ?? null}
                  initialWhyNot={linkedQuestion.feedbackWhyNot ?? null}
                  initialBetterQuestion={linkedQuestion.feedbackBetterQuestion ?? null}
                  onDecisionMade={() => setQuestionDecision(true)}
                />
              ) : mapping ? (
                <CreateQuestionCard
                  key={`question-${suggestionKey}`}
                  workspaceId={mapping.workspaceId}
                  entityId={mapping.targetField?.entityId ?? ""}
                  fieldId={mapping.targetFieldId}
                  fieldMappingId={fieldMappingId}
                  suggestedQuestion={effectiveUpdate?.question ? String(effectiveUpdate.question) : null}
                  suggestionApplied={false}
                  aiHasOpinion={aiHasReviewed}
                  onDecisionMade={() => setQuestionDecision(true)}
                />
              ) : null}
            </div>
          </div>

          {/* Other Notes — spans full width */}
          <div className="border-t border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 px-3 py-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Other Notes</span>
            </div>
            <textarea
              ref={notesRef}
              defaultValue={
                // Strip Linear reference section (shown in mapping summary instead)
                (mapping?.notes || "").split("--- Linear Reference ---")[0].trim()
              }
              placeholder="Additional context, observations, or notes about this field..."
              rows={2}
              className={cn(
                "w-full text-xs rounded border bg-background px-2 py-1 resize-none",
                "border-border focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
              )}
            />
          </div>

        </div>

        {/* AI Assistant — below feedback, available for follow-up conversation */}
        <div className="flex-1 flex flex-col min-h-0 border-t">
          <div className="px-3 py-1.5 border-b bg-muted/30 shrink-0">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">AI Assistant</span>
          </div>
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Pre-generated review (shows immediately, before chat loads) */}
            {aiReview?.reviewText && messages.length === 0 && !isStreaming && (
              <div className="px-3 py-2 text-xs border-b bg-muted/10">
                <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">AI Review</span>
                <div className="mt-0.5 text-foreground leading-relaxed">
                  <CitationMarkdown className="prose prose-sm prose-neutral text-xs max-w-none">
                    {aiReview.reviewText}
                  </CitationMarkdown>
                </div>
              </div>
            )}
            <ChatMessageList
              messages={messages}
              streamingContent={streamingContent}
              isStreaming={isStreaming}
              activeToolCall={activeToolCall}
              openQuestion={linkedQuestion && linkedQuestion.status === "open"
                ? { id: linkedQuestion.id, question: linkedQuestion.question }
                : null}
              onPromoteAnswer={handlePromoteAnswer}
            />
            <ChatInput
              onSend={(content, opts) => {
                trackChatSent();
                return sendMessage(content, opts);
              }}
              disabled={isStreaming || !activeSessionId}
            />
          </div>
        </div>

        {/* Extras */}
        <div className="shrink-0">
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

          {/* Session complete navigation removed — Submit Review & Next button handles this */}
        </div>

        {/* Submit review bar */}
        {(() => {
          // Allow submit if: (1) all three verdicts provided, OR (2) field is unmapped and a question decision was made
          const isUnmapped = mappingState?.mappingType === null && !mappingState?.sourceEntityName;
          const canSubmit = (!!sourceDecision && !!transformDecision && questionDecision)
            || (isUnmapped && questionDecision);
          return (
            <div className="shrink-0 border-t border-blue-200 dark:border-blue-800 px-4 py-2.5 flex items-center justify-between bg-blue-50 dark:bg-blue-950/40">
              <div className="flex items-center gap-4 text-xs">
                <span className={cn("flex items-center gap-1.5", sourceDecision ? "text-green-600" : "text-muted-foreground")}>
                  <span className={cn("w-1.5 h-1.5 rounded-full", sourceDecision ? "bg-green-500" : "bg-muted-foreground/30")} />
                  Source: {sourceDecision || "awaiting review"}
                </span>
                <span className={cn("flex items-center gap-1.5", transformDecision ? "text-green-600" : "text-muted-foreground")}>
                  <span className={cn("w-1.5 h-1.5 rounded-full", transformDecision ? "bg-green-500" : "bg-muted-foreground/30")} />
                  Transform: {transformDecision || "awaiting review"}
                </span>
                <span className={cn("flex items-center gap-1.5", questionDecision ? "text-green-600" : "text-muted-foreground")}>
                  <span className={cn("w-1.5 h-1.5 rounded-full", questionDecision ? "bg-green-500" : "bg-muted-foreground/30")} />
                  Question: {questionDecision ? "resolved" : "awaiting review"}
                </span>
              </div>
              <Button
                size="sm"
                onClick={async () => {
                  setReviewSubmitted(true);
                  trackSubmitted();
                  if (!activeMappingId) return;

                  // Promote any pending_review questions for this field to draft (visible to admin)
                  try {
                    const { workspaceId: wsId } = mapping || {};
                    if (wsId) {
                      await fetch(`/api/workspaces/${wsId}/questions/promote`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ fieldMappingId }),
                      });
                    }
                  } catch {
                    // Non-critical — questions will stay pending_review
                  }

                  // Build update payload: if reviewer accepted AI suggestion, include the proposed changes
                  const hasAiCorrection = effectiveUpdate && (sourceDecision === "wrong" || transformDecision === "wrong");
                  const notesValue = notesRef.current?.value?.trim() || null;
                  const updatePayload: Record<string, unknown> = { id: activeMappingId, status: "accepted", notes: notesValue };

                  if (hasAiCorrection && effectiveUpdate) {
                    // Include all proposed fields — the API will resolve names to IDs
                    const patchData = { ...effectiveUpdate };
                    if (patchData.mappingType && !MAPPING_TYPES.includes(patchData.mappingType as typeof MAPPING_TYPES[number])) {
                      patchData.mappingType = "derived";
                    }
                    if (patchData.confidence && !CONFIDENCE_LEVELS.includes(patchData.confidence as typeof CONFIDENCE_LEVELS[number])) {
                      patchData.confidence = "medium";
                    }
                    // Remove question field — not a mapping field
                    delete patchData.question;
                    Object.assign(updatePayload, patchData);
                  }

                  updateMapping.mutate(
                    updatePayload as unknown as Parameters<typeof updateMapping.mutate>[0],
                    {
                      onSuccess: () => {
                        const next = siblingNav?.nextFields?.[0];
                        if (next?.mappingId) {
                          router.push(`/mapping/discuss/${next.mappingId}`);
                        } else {
                          const tid = mapping?.transferId;
                          router.push(tid ? `/transfers/${tid}/review` : "/mapping");
                        }
                      },
                    }
                  );
                }}
                disabled={!canSubmit}
                className={cn(
                  "text-xs border",
                  canSubmit
                    ? "bg-blue-600 hover:bg-blue-700 text-white border-blue-600"
                    : "bg-blue-200 text-blue-400 border-blue-300 cursor-not-allowed dark:bg-blue-950/30 dark:text-blue-700 dark:border-blue-800"
                )}
              >
                Submit Review & Next
              </Button>
            </div>
          );
        })()}

        {/* Mapping version history (shows prior generations with verdicts) */}
        <div className="shrink-0">
          <MappingHistoryPanel
            mappingId={activeMappingId}
            transferId={mapping?.transferId ?? null}
          />
        </div>

        {/* Bottom: Prior sessions */}
        <div className="shrink-0">
          <PriorSessionsPanel
            sessions={displayedPriorSessions}
            viewedSessionId={viewedPriorSessionId}
            onToggle={(id) =>
              setViewedPriorSessionId((prev) => (prev === id ? null : id))
            }
          />
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
                entityMetadata: null,
              } satisfies ReviewCardData
            }
            onClose={() => {
              setShowRipple(false);
              setRippleMappingId(null);
            }}
          />
        )}

        {/* Punt dialog */}
        {showPuntDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="fixed inset-0 bg-black/50" onClick={() => setShowPuntDialog(false)} />
            <div className="relative bg-background rounded-xl shadow-lg w-full max-w-md p-6 space-y-4">
              <h3 className="text-lg font-semibold">Punt Mapping</h3>
              <p className="text-sm text-muted-foreground">
                Pass <strong>{entityName}.{targetFieldName}</strong> to another reviewer.
                It will be auto-assigned to the least-loaded team member.
              </p>
              <div className="space-y-2">
                <label className="text-sm font-medium">Reason</label>
                <textarea
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm min-h-[80px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="Why are you punting this mapping?"
                  value={puntNote}
                  onChange={(e) => setPuntNote(e.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => { setShowPuntDialog(false); setPuntNote(""); }}>
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    if (!puntNote.trim()) return;
                    puntMutation.mutate(
                      { mappingId: activeMappingId, note: puntNote.trim() },
                      {
                        onSuccess: () => {
                          setShowPuntDialog(false);
                          setPuntNote("");
                          const tid = mapping?.transferId;
                          const next = siblingNav?.nextFields?.[0];
                          if (next?.mappingId) {
                            router.push(`/mapping/discuss/${next.mappingId}`);
                          } else {
                            router.push(tid ? `/transfers/${tid}/review` : "/mapping");
                          }
                        },
                      }
                    );
                  }}
                  disabled={!puntNote.trim() || puntMutation.isPending}
                >
                  {puntMutation.isPending ? "Punting..." : "Punt"}
                </Button>
              </div>
              {puntMutation.isError && (
                <p className="text-sm text-destructive">
                  {puntMutation.error.message}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
