"use client";

import React, { useMemo } from "react";
import { useAppStore } from "@/store/useAppStore";
import { useAISettingsStore } from "@/store/useAISettingsStore";
import { useKiroRuntime, useKiroSessionMeta } from "@/components/kiro/KiroSessionProvider";
import { useAIModelCatalog } from "@/hooks/useAIModelCatalog";
import { getActiveModelVendor } from "@/lib/ai/providers/registry";
import { KiroEmptyState } from "@/components/kiro/KiroEmptyState";
import { KiroConversation } from "@/components/kiro/KiroConversation";
import { KiroComposer } from "@/components/kiro/KiroComposer";
import { KiroContextSuggestions } from "@/components/kiro/KiroContextSuggestions";
import { useKiroPreferencesStore } from "@/store/useKiroPreferencesStore";
import { useKiroComputerStore } from "@/store/useKiroComputerStore";
import { useKiroComputerRuntimeStore } from "@/store/useKiroComputerRuntimeStore";
import { ComputerApprovalDialog } from "@/components/kiro/computer/ComputerApprovalDialog";
import { KiroChangeReviewDialog } from "@/components/kiro/computer/KiroChangeReviewDialog";
import { getModelCapabilities } from "@/lib/ai/providers/capabilities";
import { resolveEffectiveReasoningEffort } from "@/lib/ai/reasoning/effective";
import { getKiroOutputFontSize } from "@/lib/ai/ui/typography";

/**
 * Kiro Chat Surface：Workspace 与 Sidecar 共用的完整对话面。
 * （Empty/Conversation + Context + Suggestions + Composer）
 * 业务逻辑完全一致，只是显示密度不同（variant）。
 */
export function KiroChatSurface({ variant }: { variant: "workspace" | "sidecar" }) {
  const runtime = useKiroRuntime();
  const { chat, attachments, activeRefs, removeContext, addManualContext } = runtime;
  const { suggestionsKind, suggestionsGen, lastUserTurnGen } = useKiroSessionMeta();
  const compact = variant === "sidecar";

  // Computer Agent Part 3：审批对话框 + 更改审查（runtime store 只存展示状态）
  const pendingApproval = useKiroComputerRuntimeStore((s) => s.pendingApproval);
  const setPendingApproval = useKiroComputerRuntimeStore((s) => s.setPendingApproval);
  const reviewTaskId = useKiroComputerRuntimeStore((s) => s.reviewTaskId);
  const setReviewTaskId = useKiroComputerRuntimeStore((s) => s.setReviewTaskId);

  // Task 7C：Kiro 输出字号（顶层一次订阅；CSS variable 让所有历史 Message 同步缩放，不逐条订阅）
  const outputTextSize = useKiroPreferencesStore((s) => s.outputTextSize);
  const outputFontSize = getKiroOutputFontSize(outputTextSize);

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

  // ---- Kiro Computer Agent V1：Composer Computer 模式 owner（订阅 stores + capability）----
  const {
    computerEnabled,
    activeWorkspaceId,
    agentMode,
    workspaces,
    setComputerEnabled,
    setActiveWorkspaceId,
    setAgentMode,
    addWorkspace,
  } = useKiroComputerStore();
  const reasoningEffort = useAISettingsStore((s) => s.reasoningEffort);
  const setReasoningEffort = useAISettingsStore((s) => s.setReasoningEffort);
  const reasoningCapability = useMemo(
    () => getModelCapabilities({ provider, model, custom }).reasoning,
    [provider, model, custom]
  );
  // Store 保存 requested preference；Composer 只展示 effective（当前模型 capability 归一后）。
  // 例如 DeepSeek requested=low → 显示「默认」；Custom requested=max → 显示「默认」。
  const effectiveReasoningEffort = useMemo(
    () => resolveEffectiveReasoningEffort({ provider, model, custom, requested: reasoningEffort }),
    [provider, model, custom, reasoningEffort]
  );
  const workspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;
  const workspaceIsSandbox =
    workspace?.roots.every(
      (r) => r.adapterRef === "sandbox-default" || r.adapterRef.startsWith("sandbox")
    ) ?? false;

  // Computer toggle：无 workspace 时走 canonical Sandbox 引导（CI-friendly；绝不产生重复 Sandbox）
  const handleToggleComputer = (enabled: boolean) => {
    if (!enabled) {
      setComputerEnabled(false);
      return;
    }
    if (workspaces.length === 0) {
      useKiroComputerStore.getState().ensureDefaultSandboxWorkspace();
      return;
    }
    if (!activeWorkspaceId) setActiveWorkspaceId(workspaces[0].id);
    setComputerEnabled(true);
  };

  const hasMessages = chat.messages.length > 0;
  // Context-aware 建议可见时，隐藏 EmptyState 的通用建议（两者不同时出现）
  const hasContextSuggestions =
    suggestionsKind != null && suggestionsGen > lastUserTurnGen;
  // Workspace 与 Sidecar 都启用 Context-aware Suggestions（无消息时渲染在标题下方）
  const emptyContextSuggestions =
    !hasMessages && hasContextSuggestions ? (
      <KiroContextSuggestions compact={compact} inset={false} />
    ) : undefined;

  return (
    <div
      className="relative flex-1 min-h-0 flex flex-col"
      style={{ "--kiro-output-font-size": `${outputFontSize}px` } as React.CSSProperties}
    >
      {!hasMessages ? (
        <KiroEmptyState
          onSuggestion={chat.send}
          compact={compact}
          contextSuggestions={emptyContextSuggestions}
        />
      ) : (
        <KiroConversation
          messages={chat.messages}
          error={chat.error}
          onRetry={chat.retry}
          onOpenSettings={openKiroSettings}
          onUndo={chat.consumeUndo}
          onEditUserMessage={chat.editAndResend}
          compact={compact}
          // Streaming UX V3：真实 turn lifecycle（awaiting-tool-result / awaiting-continuation 也视为 in-flight）
          turnInFlight={chat.turnInFlight}
          sources={chat.sources}
          onReviewComputerTask={setReviewTaskId}
          onUndoComputerTask={(taskId) => void chat.undoTask(taskId)}
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
        turnInFlight={chat.turnInFlight}
        runtimeStatus={chat.status}
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
        computerEnabled={computerEnabled}
        onToggleComputer={handleToggleComputer}
        agentMode={agentMode}
        onSetAgentMode={setAgentMode}
        reasoningCapability={reasoningCapability}
        reasoningEffort={effectiveReasoningEffort}
        onSetReasoningEffort={setReasoningEffort}
        workspace={workspace}
        workspaceIsSandbox={workspaceIsSandbox}
      />

      {/* Computer Agent Part 3：Approval（ask 暂停；决策后 resume 同一条 exact call）+ Change Review */}
      <ComputerApprovalDialog request={pendingApproval} onDecision={(id, decision) => void chat.resolveApproval(id, decision)} />
      <KiroChangeReviewDialog
        task={
          reviewTaskId
            ? (chat.messages.find((m) => m.computerTask?.id === reviewTaskId)?.computerTask ?? null)
            : null
        }
        onOpenChange={(open) => {
          if (!open) setPendingApproval(null);
          setReviewTaskId(null);
        }}
      />
    </div>
  );
}
