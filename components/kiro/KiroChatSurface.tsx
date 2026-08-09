"use client";

import React, { useMemo } from "react";
import { useAppStore } from "@/store/useAppStore";
import { useAISettingsStore } from "@/store/useAISettingsStore";
import { useKiroSession } from "@/components/kiro/KiroSessionProvider";
import { getModelsForProvider, getActiveModelName, getActiveModelVendor } from "@/lib/ai/providers/registry";
import { KiroEmptyState } from "@/components/kiro/KiroEmptyState";
import { KiroConversation } from "@/components/kiro/KiroConversation";
import { KiroComposer } from "@/components/kiro/KiroComposer";
import { KiroContextSuggestions } from "@/components/kiro/KiroContextSuggestions";

/**
 * Kiro Chat Surface：Workspace 与 Sidecar 共用的完整对话面。
 * （Empty/Conversation + Context + Suggestions + Composer）
 * 业务逻辑完全一致，只是显示密度不同（variant）。
 */
export function KiroChatSurface({ variant }: { variant: "workspace" | "sidecar" }) {
  const session = useKiroSession();
  const { chat, attachments, activeRefs, removeContext, addManualContext } = session;
  const compact = variant === "sidecar";

  const provider = useAISettingsStore((s) => s.provider);
  const model = useAISettingsStore((s) => s.model);
  const custom = useAISettingsStore((s) => s.custom);
  const setModel = useAISettingsStore((s) => s.setModel);
  const setSettingsModalOpen = useAppStore((s) => s.setSettingsModalOpen);
  const setSettingsTargetSection = useAppStore((s) => s.setSettingsTargetSection);

  const modelOptions = useMemo(() => {
    if (provider === "custom-openai") {
      return custom.model
        ? [{ value: custom.model, label: custom.model, vendor: null }]
        : [];
    }
    return getModelsForProvider(provider).map((m) => ({
      value: m.id,
      label: m.name,
      vendor: m.vendor,
    }));
  }, [provider, custom.model]);

  const activeModelName = useMemo(
    () => getActiveModelName({ provider, model, customModel: custom.model }),
    [provider, model, custom.model]
  );
  const activeModelVendor = useMemo(
    () => getActiveModelVendor({ provider, model, customModel: custom.model }),
    [provider, model, custom.model]
  );

  const openKiroSettings = () => {
    setSettingsTargetSection("kiro");
    setSettingsModalOpen(true);
  };

  const hasMessages = chat.messages.length > 0;
  // Context-aware 建议可见时，隐藏 EmptyState 的通用建议（两者不同时出现）
  const hasContextSuggestions =
    session.suggestionsKind != null && session.suggestionsGen > session.lastUserTurnGen;

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      {!hasMessages ? (
        <KiroEmptyState
          onSuggestion={chat.send}
          compact={compact}
          hideSuggestions={variant === "sidecar" && hasContextSuggestions}
        />
      ) : (
        <KiroConversation
          messages={chat.messages}
          activity={chat.activity}
          error={chat.error}
          onRetry={chat.retry}
          onOpenSettings={openKiroSettings}
          onUndo={chat.consumeUndo}
          compact={compact}
        />
      )}

      {variant === "sidecar" && <KiroContextSuggestions compact />}

      <KiroComposer
        compact={compact}
        contexts={activeRefs}
        onAddContext={addManualContext}
        onRemoveContext={removeContext}
        onSend={chat.send}
        streaming={chat.streaming}
        onStop={chat.stop}
        configured={chat.configured}
        modelOptions={modelOptions}
        activeModelName={activeModelName}
        selectedModelId={model}
        activeModelVendor={activeModelVendor}
        onSelectModel={setModel}
        onOpenSettings={openKiroSettings}
        attachments={attachments.views}
        hasProcessing={attachments.hasProcessing}
        visionEnabled={chat.visionEnabled}
        onAddFiles={attachments.addFiles}
        onRemoveAttachment={attachments.remove}
        onRetryAttachment={attachments.retry}
        onSaveAttachmentToCourse={attachments.saveToCourse}
        onAddMaterial={attachments.addMaterial}
      />
    </div>
  );
}
