"use client";

import React, { useMemo, useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { useAISettingsStore } from "@/store/useAISettingsStore";
import { useKiroChat } from "@/hooks/useKiroChat";
import { useKiroAttachments } from "@/hooks/useKiroAttachments";
import { getModelsForProvider, getActiveModelName, getActiveModelVendor } from "@/lib/ai/providers/registry";
import { buildAutoContextRefs } from "@/lib/ai/context/contextSelection";
import { KiroContextRef } from "@/lib/ai/context/types";
import { KiroHeader } from "@/components/kiro/KiroHeader";
import { KiroEmptyState } from "@/components/kiro/KiroEmptyState";
import { KiroConversation } from "@/components/kiro/KiroConversation";
import { KiroComposer } from "@/components/kiro/KiroComposer";
import { KiroContextBar } from "@/components/kiro/KiroContextBar";
import { KiroHistoryPanel } from "@/components/kiro/KiroHistoryPanel";

/**
 * Kiro Workspace（Task 2）：真实 Read Tools + 自动/手动 Context。
 * Chat state 由 useKiroChat 管理；Context 状态（手动 refs + 被抑制的自动 refs）
 * 在此维护并在每次发送时传入请求体。
 */
export function KiroWorkspace() {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [manualRefs, setManualRefs] = useState<KiroContextRef[]>([]);
  const [suppressedAutoKeys, setSuppressedAutoKeys] = useState<string[]>([]);

  // 自动 Context（进入 Kiro 时自动解析，UI 可见；可临时抑制）
  // 每次渲染读取最新 Store：选中实体变化时自动更新
  const autoRefs = buildAutoContextRefs();
  const visibleAutoRefs = autoRefs.filter((r) => !suppressedAutoKeys.includes(r.key));
  const activeRefs = [...visibleAutoRefs, ...manualRefs];

  const attachmentsState = useKiroAttachments();
  const chat = useKiroChat({ manualRefs, suppressedAutoKeys, attachments: attachmentsState.attachments });

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

  const removeContext = (key: string) => {
    // 自动 → 抑制；手动 → 移除
    const isAuto = autoRefs.some((r) => r.key === key);
    if (isAuto) {
      setSuppressedAutoKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
    } else {
      setManualRefs((prev) => prev.filter((r) => r.key !== key));
    }
  };

  const newChat = () => {
    chat.newChat();
    setManualRefs([]);
    setSuppressedAutoKeys([]);
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
            activity={chat.activity}
            error={chat.error}
            onRetry={chat.retry}
            onOpenSettings={openKiroSettings}
            onUndo={chat.consumeUndo}
          />
        )}

        <KiroComposer
          contexts={activeRefs}
          onAddContext={(ref) => {
            setManualRefs((prev) => (prev.some((r) => r.key === ref.key) ? prev : [...prev, ref]));
          }}
          onRemoveContext={removeContext}
          onSend={(text) => {
            chat.send(text);
            attachmentsState.clear();
          }}
          streaming={chat.streaming}
          onStop={chat.stop}
          configured={chat.configured}
          modelOptions={modelOptions}
          activeModelName={activeModelName}
          selectedModelId={model}
          activeModelVendor={activeModelVendor}
          onSelectModel={setModel}
          onOpenSettings={openKiroSettings}
          attachments={attachmentsState.views}
          hasProcessing={attachmentsState.hasProcessing}
          visionEnabled={chat.visionEnabled}
          onAddFiles={attachmentsState.addFiles}
          onRemoveAttachment={attachmentsState.remove}
          onRetryAttachment={attachmentsState.retry}
          onSaveAttachmentToCourse={attachmentsState.saveToCourse}
          onAddMaterial={attachmentsState.addMaterial}
        />

        {historyOpen && (
          <KiroHistoryPanel onClose={() => setHistoryOpen(false)} onNewChat={newChat} />
        )}
      </div>
    </div>
  );
}
