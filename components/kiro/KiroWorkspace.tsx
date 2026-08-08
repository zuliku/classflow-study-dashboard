"use client";

import React, { useMemo, useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { useAISettingsStore } from "@/store/useAISettingsStore";
import { useKiroChat } from "@/hooks/useKiroChat";
import { getModelsForProvider, getActiveModelName, getActiveModelVendor } from "@/lib/ai/providers/registry";
import { KiroHeader } from "@/components/kiro/KiroHeader";
import { KiroEmptyState } from "@/components/kiro/KiroEmptyState";
import { KiroConversation } from "@/components/kiro/KiroConversation";
import { KiroComposer } from "@/components/kiro/KiroComposer";
import { KiroContextChip } from "@/components/kiro/KiroContextBar";
import { KiroHistoryPanel } from "@/components/kiro/KiroHistoryPanel";

/**
 * Kiro Workspace（Task 1）：真实 AI 流式聊天。
 * Chat state 由 useKiroChat（AI SDK useChat）管理，UI 组件保持 Task 0 视觉。
 * 本阶段不发送任何 ClassFlow Context / 数据。
 */
export function KiroWorkspace() {
  const chat = useKiroChat();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [manualContexts, setManualContexts] = useState<KiroContextChip[]>([]);

  // AI 设置（模型选择器数据源）
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

  const addManualContext = (chip: KiroContextChip) => {
    setManualContexts((prev) => (prev.some((c) => c.id === chip.id) ? prev : [...prev, chip]));
  };
  const removeContext = (id: string) => {
    setManualContexts((prev) => prev.filter((c) => c.id !== id));
  };

  const newChat = () => {
    chat.newChat();
    setManualContexts([]);
  };

  const hasMessages = chat.messages.length > 0;

  return (
    <div
      data-testid="kiro-workspace"
      className="h-[calc(100dvh-170px)] md:h-[calc(100dvh-96px)] flex flex-col"
    >
      <KiroHeader onNewChat={newChat} onOpenHistory={() => setHistoryOpen(true)} />

      <div className="relative flex-1 min-h-0 flex flex-col">
        {!hasMessages ? (
          <KiroEmptyState onSuggestion={chat.send} />
        ) : (
          <KiroConversation
            messages={chat.messages}
            error={chat.error}
            onRetry={chat.retry}
            onOpenSettings={openKiroSettings}
          />
        )}

        <KiroComposer
          contexts={manualContexts}
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
        />

        {historyOpen && (
          <KiroHistoryPanel onClose={() => setHistoryOpen(false)} onNewChat={newChat} />
        )}
      </div>
    </div>
  );
}
