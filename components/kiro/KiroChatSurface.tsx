"use client";

import React, { useMemo } from "react";
import { useAppStore } from "@/store/useAppStore";
import { useAISettingsStore } from "@/store/useAISettingsStore";
import { useKiroSession } from "@/components/kiro/KiroSessionProvider";
import { useAIModelCatalog } from "@/hooks/useAIModelCatalog";
import { getActiveModelVendor } from "@/lib/ai/providers/registry";
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

  // 统一模型 Catalog：Settings 与 Composer 共用同一模型集合（Task 10）
  const { models: catalogModels } = useAIModelCatalog(provider);

  const modelOptions = useMemo(() => {
    if (provider === "custom-openai") {
      return custom.model
        ? [{ value: custom.model, label: custom.model, vendor: null }]
        : [];
    }
    return catalogModels.map((m) => ({
      value: m.id,
      label: m.name,
      vendor: m.vendor,
    }));
  }, [provider, custom.model, catalogModels]);

  // 当前模型失效（不在 Catalog）：提示重新选择，不自动覆盖设置
  const modelUnavailable =
    provider !== "custom-openai" && !!model && !catalogModels.some((m) => m.id === model);

  const activeModel = useMemo(
    () => catalogModels.find((m) => m.id === model),
    [catalogModels, model]
  );
  const activeModelName = modelUnavailable
    ? "模型不可用"
    : activeModel?.name ??
      (provider === "custom-openai" ? (custom.model ? custom.model : "未设置模型") : "选择模型");
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
  // Workspace 与 Sidecar 都启用 Context-aware Suggestions（无消息时渲染在标题下方）
  const emptyContextSuggestions =
    !hasMessages && hasContextSuggestions ? (
      <KiroContextSuggestions compact={compact} inset={false} />
    ) : undefined;

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      {!hasMessages ? (
        <KiroEmptyState
          onSuggestion={chat.send}
          compact={compact}
          contextSuggestions={emptyContextSuggestions}
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
          turnInFlight={chat.streaming}
          sources={chat.sources}
        />
      )}

      {variant === "sidecar" && hasMessages && hasContextSuggestions && <KiroContextSuggestions compact />}

      <KiroComposer
        compact={compact}
        contexts={activeRefs}
        onAddContext={addManualContext}
        onRemoveContext={removeContext}
        onSend={chat.send}
        streaming={chat.streaming}
        onStop={chat.stop}
        configured={chat.configured}
        preparingVision={chat.preparingVision}
        modelOptions={modelOptions}
        activeModelName={activeModelName}
        selectedModelId={model}
        modelUnavailable={modelUnavailable}
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
