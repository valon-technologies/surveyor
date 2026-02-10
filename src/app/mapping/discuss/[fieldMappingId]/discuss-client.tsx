"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import { ChatInput } from "@/components/chat/chat-input";
import { MappingStateCard } from "@/components/chat/mapping-state-card";
import { useMapping, useUpdateMapping } from "@/queries/mapping-queries";
import { useAcceptMapping } from "@/queries/review-queries";
import { useCreateChatSession, useChatSession } from "@/queries/chat-queries";
import { useChatStream } from "@/lib/hooks/use-chat-stream";
import { useVoiceOutput } from "@/lib/hooks/use-voice-output";
import { ArrowLeft, Check, Volume2, VolumeX } from "lucide-react";

export function DiscussClient() {
  const params = useParams<{ fieldMappingId: string }>();
  const router = useRouter();
  const fieldMappingId = params.fieldMappingId;

  const { data: mapping } = useMapping(fieldMappingId);
  const createSession = useCreateChatSession();
  const acceptMutation = useAcceptMapping();
  const updateMapping = useUpdateMapping();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const { data: sessionData } = useChatSession(sessionId);

  const {
    messages,
    isStreaming,
    streamingContent,
    pendingUpdate,
    sendMessage,
    setMessages,
  } = useChatStream(sessionId);

  const {
    isSupported: voiceOutputSupported,
    voiceEnabled,
    setVoiceEnabled,
    speak,
  } = useVoiceOutput();

  // Auto-speak new assistant messages when voice output is enabled
  useEffect(() => {
    if (!voiceEnabled || messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role === "assistant") {
      speak(lastMsg.content);
    }
  }, [messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Create or load chat session on mount
  useEffect(() => {
    if (!fieldMappingId || sessionId) return;

    createSession.mutate(
      { fieldMappingId },
      {
        onSuccess: (session) => {
          setSessionId(session.id);
        },
      }
    );
  }, [fieldMappingId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load existing messages when session loads
  useEffect(() => {
    if (sessionData?.messages) {
      setMessages(sessionData.messages);
    }
  }, [sessionData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derive mapping state for the right panel
  const mappingState = mapping
    ? {
        mappingType: mapping.mappingType ?? null,
        sourceEntityName: mapping.sourceField?.entityName || null,
        sourceFieldName: mapping.sourceField?.displayName || mapping.sourceField?.name || null,
        transform: mapping.transform ?? null,
        defaultValue: mapping.defaultValue ?? null,
        enumMapping: mapping.enumMapping ?? null,
        reasoning: mapping.reasoning ?? null,
        confidence: mapping.confidence ?? null,
        notes: mapping.notes ?? null,
      }
    : null;

  const targetFieldName =
    mapping?.targetField?.displayName || mapping?.targetField?.name || "Field";
  const entityName = "Entity";

  const handleApplyUpdate = (update: Record<string, unknown>) => {
    if (!fieldMappingId) return;
    updateMapping.mutate({
      id: fieldMappingId,
      ...update,
    });
  };

  const handleAccept = () => {
    acceptMutation.mutate(fieldMappingId, {
      onSuccess: () => router.push("/mapping"),
    });
  };

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
        <div className="flex items-center gap-2">
          {voiceOutputSupported && (
            <Button
              size="icon"
              variant={voiceEnabled ? "default" : "outline"}
              onClick={() => setVoiceEnabled(!voiceEnabled)}
              title={voiceEnabled ? "Disable voice output" : "Enable voice output"}
              className="h-8 w-8"
            >
              {voiceEnabled ? (
                <Volume2 className="h-3.5 w-3.5" />
              ) : (
                <VolumeX className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
          <Button
            size="sm"
            onClick={handleAccept}
            disabled={acceptMutation.isPending}
            className="bg-green-600 hover:bg-green-700"
          >
            <Check className="h-3.5 w-3.5" />
            Accept Mapping
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Chat */}
        <div className="flex-1 flex flex-col min-w-0">
          <ChatMessageList
            messages={messages}
            streamingContent={streamingContent}
            isStreaming={isStreaming}
          />
          <ChatInput
            onSend={sendMessage}
            disabled={isStreaming || !sessionId}
          />
        </div>

        {/* Right: Mapping state */}
        {mappingState && (
          <MappingStateCard
            targetFieldName={targetFieldName}
            entityName={entityName}
            mapping={mappingState}
            pendingUpdate={pendingUpdate}
            onApplyUpdate={handleApplyUpdate}
          />
        )}
      </div>
    </div>
  );
}
