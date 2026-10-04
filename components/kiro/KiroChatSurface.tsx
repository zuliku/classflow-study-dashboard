"use client";

import React, { useCallback, useMemo, useRef } from "react";
import { useAppStore } from "@/store/useAppStore";
import { useAISettingsStore } from "@/store/useAISettingsStore";
import { useKiroRuntime, useKiroSessionMeta, useKiroSessionActions } from "@/components/kiro/KiroSessionProvider";
import { KiroEmptyExperience } from "@/components/kiro/motion/KiroEmptyExperience";
import { useAIModelCatalog } from "@/hooks/useAIModelCatalog";
import { getActiveModelName, getActiveModelVendor, getModelContextWindowTokens, getModelsForProvider } from "@/lib/ai/providers/registry";
import { findApprovalOwnerMessageId } from "@/lib/ai/ui/kiroAgentRun";
import type { ComputerApprovalDecision } from "@/lib/ai/computer/approval";
import { KiroConversation } from "@/components/kiro/KiroConversation";
import { KiroComposer } from "@/components/kiro/KiroComposer";
import { KiroContextSuggestions } from "@/components/kiro/KiroContextSuggestions";
import { useKiroPreferencesStore } from "@/store/useKiroPreferencesStore";
import { useKiroComputerStore } from "@/store/useKiroComputerStore";
import { useToastStore } from "@/store/useToastStore";
import { useKiroComputerRuntimeStore } from "@/store/useKiroComputerRuntimeStore";
import { useDesktopSessionStore } from "@/store/useDesktopSessionStore";
import { ComputerApprovalDialog } from "@/components/kiro/computer/ComputerApprovalDialog";
import { KiroComputerSessionSurface } from "@/components/kiro/computer/session/KiroComputerSessionSurface";
import { KiroChangeReviewDialog } from "@/components/kiro/computer/KiroChangeReviewDialog";
import { getModelCapabilities } from "@/lib/ai/providers/capabilities";
import { resolveEffectiveReasoningEffort } from "@/lib/ai/reasoning/effective";
import { getKiroOutputFontSize } from "@/lib/ai/ui/typography";
import { usePresence } from "@/lib/usePresence";
import { ExitCollapse } from "@/components/ui/ExitCollapse";
import { MOTION_EXIT_MS } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Kiro Chat Surface：Workspace 与 Sidecar 共用的完整对话面。
 * （Empty/Conversation + Context + Suggestions + Composer）
 * 业务逻辑完全一致，只是显示密度不同（variant）。
 */
export function KiroChatSurface({ variant }: { variant: "workspace" | "sidecar" }) {
  const runtime = useKiroRuntime();
  const { chat, attachments, activeRefs, removeContext, addManualContext } = runtime;
  const { suggestionsKind, suggestionsGen, lastUserTurnGen, emptyIntroGeneration, currentConversationId } = useKiroSessionMeta();
  const { claimEmptyIntro, newChat } = useKiroSessionActions();
  const compact = variant === "sidecar";

  // Motion V1：Empty Intro claim（每 generation 每 surface 一次）。
  // 渲染期缓存 claim 结果 —— 同 generation 内后续 re-render 返回相同值，intro 类不闪失；
  // new chat → generation 递增 → 缓存失效 → 可再次 claim。
  const introClaimRef = useRef<{ generation: number; value: boolean }>({ generation: -1, value: false });
  const playIntro = (() => {
    if (chat.messages.length > 0) return false;
    if (introClaimRef.current.generation === emptyIntroGeneration) return introClaimRef.current.value;
    const value = claimEmptyIntro(variant, emptyIntroGeneration);
    introClaimRef.current = { generation: emptyIntroGeneration, value };
    return value;
  })();

  // Computer Agent Part 3：审批对话框 + 更改审查（runtime store 只存展示状态）
  const rawPendingApproval = useKiroComputerRuntimeStore((s) => s.pendingApproval);
  const pendingQueueLength = useKiroComputerRuntimeStore((s) => s.pendingQueueLength);
  // P0：审批只在归属会话展示（stamped conversationId 与当前不一致 → 隐藏不断队列；切回原对话重现。
  // 未 stamp 的历史审批恒展示，避免无处可点卡死）。
  const pendingApproval =
    rawPendingApproval &&
    (rawPendingApproval.conversationId == null || rawPendingApproval.conversationId === currentConversationId)
      ? rawPendingApproval
      : null;
  const setPendingApproval = useKiroComputerRuntimeStore((s) => s.setPendingApproval);
  const reviewTaskId = useKiroComputerRuntimeStore((s) => s.reviewTaskId);
  const setReviewTaskId = useKiroComputerRuntimeStore((s) => s.setReviewTaskId);
  // P4：Desktop GUI Session 暂停（只在 Surface 订阅一次；绝不下沉到历史 Message row）
  const desktopSessionPaused = useDesktopSessionStore((s) => s.state === "paused");

  /**
   * P4 §11：orphan fallback 判定——pendingApproval 必须能通过 taskId 找到 owning Computer Task
   * （→ owning assistant row 的 Inline Approval）。找不到（row 尚未建立 / 恢复竞态 /
   * unexpected runtime state）时继续用 ComputerApprovalDialog，绝不出现「审批无处可操作」。
   *
   * 性能：computerTask 归属只随各条 task id 变化；流式 token 只改文本。用 id 序列键
   * 代替 messages 数组依赖——每 token 只做一次 map+join（便宜），归属扫描只在结构变化时跑。
   * 键包含全部 id，故无过期风险（编辑/撤销改变任一条即重扫）。
   */
  const approvalMessagesKey = useMemo(
    () => chat.messages.map((m) => m.computerTask?.id ?? "").join(","),
    [chat.messages]
  );
  const approvalOwnerMessageId = useMemo(
    () => findApprovalOwnerMessageId(chat.messages, pendingApproval?.taskId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pendingApproval?.taskId, approvalMessagesKey]
  );

  // Task 7C：Kiro 输出字号（顶层一次订阅；CSS variable 让所有历史 Message 同步缩放，不逐条订阅）
  const outputTextSize = useKiroPreferencesStore((s) => s.outputTextSize);
  const outputFontSize = getKiroOutputFontSize(outputTextSize);

  const provider = useAISettingsStore((s) => s.provider);
  const model = useAISettingsStore((s) => s.model);
  const custom = useAISettingsStore((s) => s.custom);
  const setModel = useAISettingsStore((s) => s.setModel);
  const pushToast = useToastStore((s) => s.pushToast);
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

  // 上下文占用（Codex-style ring）：快照来自最近一次真实请求（provider/model 以快照为准）；
  // 模型窗口只在 registry 有官方可核实值时显示（Phase 2）
  const contextWindowTokens = useMemo(
    () =>
      getModelContextWindowTokens({
        provider: chat.contextUsage?.provider ?? provider,
        model: chat.contextUsage?.model ?? model,
      }),
    [chat.contextUsage?.provider, chat.contextUsage?.model, provider, model]
  );

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

  // P3：Access Menu 的权限摘要（只含 boolean preference，不含 runtime 事实）
  const openKiroSettings = useCallback(() => {
    setSettingsTargetSection("kiro");
    setSettingsModalOpen(true);
  }, [setSettingsTargetSection, setSettingsModalOpen]);

  // ---- Kiro Computer Agent V1：Composer Computer 模式 owner（订阅 stores + capability）----
  // 细粒度订阅：整库解构会在 computer 任意字段变化时重渲染整个会话面（含流式中的 Conversation）；
  // 各自按需订阅，流式 token 期间无关 computer 写入不再进 render。
  const computerEnabled = useKiroComputerStore((s) => s.computerEnabled);
  const activeWorkspaceId = useKiroComputerStore((s) => s.activeWorkspaceId);
  const agentMode = useKiroComputerStore((s) => s.agentMode);
  const workspaces = useKiroComputerStore((s) => s.workspaces);
  const setComputerEnabled = useKiroComputerStore((s) => s.setComputerEnabled);
  const setActiveWorkspaceId = useKiroComputerStore((s) => s.setActiveWorkspaceId);
  const setAgentMode = useKiroComputerStore((s) => s.setAgentMode);
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
  // useCallback 稳定 identity：内联定义会在 Surface 每 render（流式每 token）时产生新回调，
  // 穿透下游 memo（Composer / Row），故此处及下方传给 Conversation 的回调全部稳定化。
  const handleToggleComputer = useCallback(
    (enabled: boolean) => {
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
    },
    [workspaces, activeWorkspaceId, setComputerEnabled, setActiveWorkspaceId]
  );

  const hasMessages = chat.messages.length > 0;
  // Context-aware 建议可见时，隐藏 EmptyState 的通用建议（两者不同时出现）
  const hasContextSuggestions =
    suggestionsKind != null && suggestionsGen > lastUserTurnGen;
  // 建议条父级 presence：裸条件会截断其内部退出折叠（同一 panel 时长对齐）
  const suggestionsPresence = usePresence(
    variant === "sidecar" && hasMessages && hasContextSuggestions,
    MOTION_EXIT_MS.panel
  );
  // Workspace 与 Sidecar 都启用 Context-aware Suggestions（无消息时渲染在标题下方）
  const emptyContextSuggestions =
    !hasMessages && hasContextSuggestions ? (
      <KiroContextSuggestions compact={compact} inset={false} />
    ) : undefined;

  // 传给 Conversation / Dialog 的回调全部稳定化：内联箭头每 render 产生新 identity，
  // 会穿透 Row / Composer memo 使流式每 token 全树重渲染（chat.* 均为 useCallback，已稳定，
  // 此处依赖它们而非空数组——方法变化时正确更新）。
  const handleApprovalDecision = useCallback(
    (id: string, decision: ComputerApprovalDecision) => void chat.resolveApproval(id, decision),
    [chat.resolveApproval]
  );
  const handleUndoComputerTask = useCallback((taskId: string) => void chat.undoComputerTask(taskId), [
    chat.undoComputerTask,
  ]);
  const handleApprovePlan = useCallback(
    (planId: string) => {
      void chat.approveExecutionPlan(planId).then((ok) => {
        if (!ok) return;
        setAgentMode("workspace-auto");
        pushToast({ message: "已批准，发下一条消息时就按这个计划执行。" });
      });
    },
    [chat.approveExecutionPlan, setAgentMode, pushToast]
  );
  const handleCancelPlan = useCallback((planId: string) => void chat.cancelExecutionPlan(planId), [
    chat.cancelExecutionPlan,
  ]);
  const handleRegenerateAnswer = useCallback(() => void chat.regenerateAnswer(), [chat.regenerateAnswer]);
  const handleNewChat = useCallback(() => newChat(), [newChat]);
  const resolveBulkApproval = (chat as unknown as { resolveBulkApproval: (d: ComputerApprovalDecision) => void })
    .resolveBulkApproval;
  const handleBulkDecision = useCallback(
    (decision: ComputerApprovalDecision) => void resolveBulkApproval(decision),
    [resolveBulkApproval]
  );
  const handleReviewDialogOpenChange = useCallback(
    (open: boolean) => {
      if (!open) setPendingApproval(null);
      setReviewTaskId(null);
    },
    [setPendingApproval, setReviewTaskId]
  );

  return (
    <div
      className={cn(
        "relative flex-1 min-h-0 flex flex-col",
        variant === "workspace" ? "kiro-motion-workspace" : "kiro-motion-sidecar"
      )}
      style={{ "--kiro-output-font-size": `${outputFontSize}px` } as React.CSSProperties}
    >
      {/* P5：Desktop Session Control Surface（Workspace / Sidecar 共用；位于 Conversation
          可滚动区之外、Composer 之上；没有真实 session → 不渲染） */}
      <KiroComputerSessionSurface variant={variant} />

      {/* Motion V1：main content stage —— Empty 为 absolute presence overlay（exit 不占 flex 布局，
          Conversation 第一条消息立即 mount；不给 Conversation 加 key / 不加 entrance animation） */}
      <div className="relative flex-1 min-h-0 flex flex-col">
        <KiroEmptyExperience
          open={!hasMessages}
          compact={compact}
          playIntro={playIntro}
          onSuggestion={chat.send}
          contextSuggestions={emptyContextSuggestions}
        />
        {hasMessages && (
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
            // P4：Inline Approval（taskId 精确匹配 owning row）；未匹配 → fallback Dialog
            pendingApproval={pendingApproval}
            approvalOwnerMessageId={approvalOwnerMessageId}
            pendingQueueLength={pendingQueueLength}
            onApprovalDecision={handleApprovalDecision}
            onBulkDecision={handleBulkDecision}
            desktopPaused={desktopSessionPaused}
            onStop={chat.stop}
            onReviewComputerTask={setReviewTaskId}
            // S-fix durable undo：live/restored 路由（restored 走 undoRestoredTask）
            onUndoComputerTask={handleUndoComputerTask}
            // plan-approve：批准 = 单次授权整计划 + 切工作区自动（下一条发送按计划执行；不自动发送）
            onApprovePlan={handleApprovePlan}
            // 空终答追答入口（view 层判定 + hook 纯文本追答链；缺失则重试按钮永不出现）
            onRegenerateAnswer={handleRegenerateAnswer}
            onCancelPlan={handleCancelPlan}
            onNewChat={handleNewChat}
          />
        )}
      </div>

      {suggestionsPresence.mounted && (
        <ExitCollapse exiting={!suggestionsPresence.visible}>
          <KiroContextSuggestions compact />
        </ExitCollapse>
      )}

      <KiroComposer
        compact={compact}
        introActive={playIntro}
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
        // V4.6：preflight claim 与 intent 冻结（preparing 期间 Send 禁用 + 「正在准备」；Stop 不出现）
        preparingSend={chat.preparingSend}
        turnIntentFrozen={chat.turnIntentFrozen}
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
        // 上下文占用（Codex-style ring）：最近一次请求的估算快照（历史恢复同样可用）
        contextUsage={chat.contextUsage}
        contextOverflow={chat.contextOverflow}
        contextWindowTokens={contextWindowTokens}
        workspace={workspace}
        workspaceIsSandbox={workspaceIsSandbox}
      />

      {/* P4：Inline Approval 为主；仅 orphan（无 owning task row）时用 fallback Dialog。
          Bulk 决策仍由 Runtime API（resolveBulkApproval）承担，此处不做批量 UI 产品化。 */}
      <ComputerApprovalDialog
        request={approvalOwnerMessageId ? null : pendingApproval}
        queueLength={pendingQueueLength}
        onDecision={handleApprovalDecision}
        onBulkDecision={handleBulkDecision}
      />
      <KiroChangeReviewDialog
        task={
          reviewTaskId
            ? (chat.messages.find((m) => m.computerTask?.id === reviewTaskId)?.computerTask ?? null)
            : null
        }
        onOpenChange={handleReviewDialogOpenChange}
      />
    </div>
  );
}
