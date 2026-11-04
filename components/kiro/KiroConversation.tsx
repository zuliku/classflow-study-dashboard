"use client";

import React, { useEffect, useRef, useState } from "react";
import { usePresence } from "@/lib/usePresence";
import { DisclosureRegion } from "@/components/ui/DisclosureRegion";
import { ExitCollapse } from "@/components/ui/ExitCollapse";
import { MOTION_EXIT_MS } from "@/lib/motion";
import { useInertOnHidden } from "@/lib/useInertOnHidden";

/** 滚动跟随/按钮阈值（px）：贴底判定 / 浮钮出现 / 直接赋值的最小有效距离 */
const SCROLL_STICK_DISTANCE_PX = 80;
const SCROLL_BUTTON_DISTANCE_PX = 160;
const SCROLL_WRITE_TOLERANCE_PX = 2;
import { KiroMessage, KiroUserMessage } from "@/components/kiro/KiroMessage";
import { KiroPendingIndicator } from "@/components/kiro/KiroWorklog";
import { KiroAssistantShell } from "@/components/kiro/KiroAssistantShell";
import { Loader2, RotateCcw, Settings, ChevronDown, Sparkles } from "lucide-react";
import { KiroChatMessageView } from "@/hooks/useKiroChat";
import { KiroSourceMeta } from "@/lib/ai/citations/types";
import { useKiroSessionMeta } from "@/components/kiro/KiroSessionProvider";
import { useEffectiveReducedMotion } from "@/hooks/useEffectiveReducedMotion";
import { AIError, AI_ERROR_MESSAGES } from "@/lib/ai/errors";
import { KiroActionCard, actionToCardProps, KiroActionCardVariant } from "@/components/kiro/KiroActionCard";
import { SkillDistillDialog } from "@/components/kiro/SkillDistillDialog";
import { extractWorkflowTraceForTurn, isWorkflowTraceReusable } from "@/lib/ai/skills/workflowTrace";
import type { WorkflowTrace } from "@/lib/ai/skills/types";
import { KiroAgentRunApprovalBinding } from "@/components/kiro/run/KiroAgentRun";
import { ComputerApprovalDecision, ComputerApprovalRequest } from "@/lib/ai/computer/approval";
import { StudyPlanProposalCard } from "@/components/kiro/StudyPlanProposalCard";
import { StudyRebalanceProposalCard } from "@/components/kiro/StudyRebalanceProposalCard";
import { TaskBreakdownProposalCard } from "@/components/kiro/TaskBreakdownProposalCard";
import { VisualActionProposalCard } from "@/components/kiro/VisualActionProposalCard";
import { TimetableImportProposalCard } from "@/components/kiro/TimetableImportProposalCard";
import { VisualActionProposalHistoryCard } from "@/components/kiro/VisualActionProposalHistoryCard";
import { resolveLiveImageSources } from "@/lib/ai/attachments/liveImageRegistry";
import { actionSummaryText } from "@/lib/ai/share";
import { cn } from "@/lib/utils";
import { useEnterOnAdd } from "@/lib/useEnterOnAdd";
import { bumpStreamPerf } from "@/lib/ai/perf/streamPerf";

/**
 * Conversation 布局：max-width 820px 居中，纵向文档流。
 * Assistant Message 分层：Worklog → Final Answer → Action Result Cards（事实 UI）。
 * 滚动（Task 5）：单一 ResizeObserver + 单一 rAF scheduler，统一 reconcile 高度。
 */
export function KiroConversation({
  messages,
  error,
  onRetry,
  onOpenSettings,
  onUndo,
  onEditUserMessage,
  compact,
  turnInFlight,
  sources,
  pendingApproval,
  approvalOwnerMessageId,
  pendingQueueLength,
  onApprovalDecision,
  onBulkDecision,
  desktopPaused,
  onStop,
  onReviewComputerTask,
  onUndoComputerTask,
  onApprovePlan,
  onCancelPlan,
  onRegenerateAnswer,
  onNewChat,
  preparingSend,
}: {
  messages: KiroChatMessageView[];
  error: AIError | null;
  onRetry: () => void;
  onOpenSettings: () => void;
  onUndo: (toolCallId: string) => void;
  /** Task 8：编辑 User Message 并重发（Task 7 的安全语义） */
  onEditUserMessage: (messageId: string, text: string) => Promise<boolean>;
  /** sidecar：统一 12px 水平 gutter（与 Header/Composer 一致） */
  compact?: boolean;
  /** 整个 Agent Turn 是否仍在进行（turnExecution !== settled；含 awaiting-tool-result / awaiting-continuation）——决定最后一条消息的操作栏时机 */
  turnInFlight: boolean;
  /** preflight 准备中（intent 冻结 + 上下文/附件并行准备，turnInFlight 尚为 false）：会话区给即时反馈，避免“点了没反应” */
  preparingSend?: boolean;
  /** 当前 Turn 的文档来源（Citation 渲染；live 消息用；不含正文） */
  sources?: KiroSourceMeta[];
  /** P4：待决策审批（只注入 owning task 行；orphan 由 ChatSurface fallback Dialog 承接） */
  pendingApproval?: ComputerApprovalRequest | null;
  /** P4：approval.taskId 精确匹配到的 owning message id（null = orphan → fallback Dialog） */
  approvalOwnerMessageId?: string | null;
  pendingQueueLength?: number;
  onApprovalDecision?: (approvalId: string, decision: ComputerApprovalDecision) => void;
  onBulkDecision?: (decision: ComputerApprovalDecision) => void;
  /** P4：Desktop GUI Session 暂停（只影响 live run） */
  desktopPaused?: boolean;
  /** P4：Run Header 停止入口（canonical Stop） */
  onStop?: () => void;
  /** Computer Agent Part 3：Task 更改审查 / 撤销（仅 live task 提供） */
  onReviewComputerTask?: (taskId: string) => void;
  onUndoComputerTask?: (taskId: string) => void;
  /** plan-approve：批准 / 取消执行计划（卡片入口） */
  onApprovePlan?: (planId: string) => void;
  onCancelPlan?: (planId: string) => void;
  /** 空终答追答（纯文本重跑；零工具） */
  onRegenerateAnswer?: () => void;
  /** 超预算失败出口（CONTEXT_TOO_LARGE 时错误条出现“新建对话”，打破原样重发必败循环） */
  onNewChat?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const [showScrollBtn, setShowScrollBtn] = React.useState(false);
  // Motion V1：回到底部浮钮 presence（enter fast / exit 同源 exit-fast；hidden 立即不可交互）
  const scrollBtnPresence = usePresence(showScrollBtn, MOTION_EXIT_MS.fast);
  // 退出隐藏后不可聚焦（aria-hidden 与键盘可达必须一致）
  const scrollBtnInertRef = useInertOnHidden<HTMLButtonElement>(!scrollBtnPresence.visible);
  const { conversationSummary, currentConversationId } = useKiroSessionMeta();
  const reducedMotion = useEffectiveReducedMotion();
  const messageIds = React.useMemo(
    () =>
      messages
        .filter((message) => isVisibleConversationMessage(message) && !message.restored)
        .map((message) => message.id),
    [messages]
  );
  const conversationScrollKey = currentConversationId ?? messages[0]?.id ?? "new";
  // V4.6：live transcript 不使用 message-level entrance 动画（真实事件到达即展示）——
  // enteringMessageIds 已移除；useEnterOnAdd 仍被 KiroActionCard 使用（其它 UI 列表保留）。

  // 最后一条 assistant 消息：其操作栏必须等整个 Turn 结束（turnInFlight false）才显示；
  // 历史 assistant 消息不受当前 Turn 影响
  let lastAssistantIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      lastAssistantIndex = i;
      break;
    }
  }

  /**
   * P4 Inline Approval 绑定（§9/§10）：只按真实 ComputerApprovalRequest.taskId 精确匹配
   * owning task → owning assistant row；未匹配（row 尚未建立 / 恢复竞态）由 ChatSurface
   * 的 fallback Dialog 承接。binding 引用稳定（approval / queue 不变则不新建），
   * 历史 row 不因 approval 更新而重渲染。
   */
  const approvalBinding: KiroAgentRunApprovalBinding | null = React.useMemo(
    () =>
      pendingApproval && onApprovalDecision
        ? {
            request: pendingApproval,
            queueLength: pendingQueueLength ?? 1,
            onDecision: onApprovalDecision,
            onBulkDecision,
          }
        : null,
    [pendingApproval, pendingQueueLength, onApprovalDecision, onBulkDecision]
  );

  /** 统一滚动状态同步（scroll 事件 / 内容高度变化共用） */
  const syncScrollState = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distance < SCROLL_STICK_DISTANCE_PX;
    const shouldShow = distance > SCROLL_BUTTON_DISTANCE_PX;
    setShowScrollBtn((prev) => (prev === shouldShow ? prev : shouldShow));
  }, []);

  // P0 流畅度：scroll 事件 60Hz 风暴 → rAF 节流（只置位 + 单帧合并一次 sync）
  const scrollRafRef = useRef<number | null>(null);
  const onScroll = React.useCallback(() => {
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      syncScrollState();
    });
  }, [syncScrollState]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, []);

  // 单一 rAF scheduler（Task 5）：高度变化只在同一帧合并一次 reconcile；
  // sticky 跟随使用直接 scrollTop 赋值（不做 smooth，避免抖动 / scroll queue）；
  // 只有确实存在距离差（tolerance 外）时才赋值，避免无意义重复写 scrollTop
  const rafRef = useRef<number | null>(null);
  const scheduleHeightReconcile = React.useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      bumpStreamPerf("resizeObserverCalls");
      const el = scrollRef.current;
      if (!el) return;
      if (stickToBottomRef.current) {
        const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (distance > SCROLL_WRITE_TOLERANCE_PX) {
          bumpStreamPerf("scrollTopWrites");
          el.scrollTop = el.scrollHeight;
        }
      }
      syncScrollState();
    });
  }, [syncScrollState]);

  // 内容高度变化（streaming / Worklog / Action / Proposal / Breakdown Card 增长）：
  // 唯一 reconcile 入口（Task 5：不再有第二套 scrollSignal 驱动路径）
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => scheduleHeightReconcile());
    observer.observe(content);
    return () => {
      observer.disconnect();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [scheduleHeightReconcile]);

  // 切换会话 / 首次挂载：重置滚动状态（历史会话默认看到最新消息；新会话不继承旧状态）
  const prevConversationKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = conversationScrollKey;
    if (prevConversationKeyRef.current === null) {
      prevConversationKeyRef.current = key;
      const el = scrollRef.current;
      if (el) {
        bumpStreamPerf("scrollTopWrites");
        el.scrollTop = el.scrollHeight;
      }
      return;
    }
    if (prevConversationKeyRef.current !== key) {
      prevConversationKeyRef.current = key;
      stickToBottomRef.current = true;
      setShowScrollBtn(false);
      const raf = requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) {
          bumpStreamPerf("scrollTopWrites");
          el.scrollTop = el.scrollHeight;
        }
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [conversationScrollKey]);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = true;
    // 用户手动点击：允许 smooth；streaming 自动跟随仍用直接赋值
    el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
    setShowScrollBtn(false);
  };

  // 首 token 前占位：turn in-flight 且当前没有任何可见 Assistant（content / worklog / action / computer task）。
  // V4.6：空 assistant message 存在时由同一 message id 的 row 承担 pending shell（outer 不 remount）；
  // fallback Pending 只在「尚无 assistant message」时显示（避免双 Logo）。
  // P0：preflight（preparingSend）同样给反馈——此前点发送后数秒对话区零变化，用户以为没点中而重发。
  const lastMsg = messages[messages.length - 1];
  const showPending = (turnInFlight || !!preparingSend) && lastMsg?.role !== "assistant";
  // 错误条退出走折叠（重试成功/切会话/新建时直接卸载会顶起滚动高度）；
  // presence 与 ExitCollapse 的 --motion-exit-panel（160ms）对齐，避免折叠尾段被截断。
  // 退出期 error 已清零，用 ref 快照保持内容直到卸载
  const errorPresence = usePresence(!!error, MOTION_EXIT_MS.panel);
  const lastErrorRef = useRef<AIError | null>(null);
  if (error) lastErrorRef.current = error;
  const shownError = error ?? lastErrorRef.current;

  return (
    // Outer Viewport Wrapper：负责浮层定位；Scroll Container 独立承担滚动（Task 6B-A）
    <div data-testid="kiro-conversation" className="relative flex-1 min-h-0">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-full overflow-y-auto"
        // scrollbar-gutter stable：滚动条恒驻右侧（出现/消失不挤占内容 → 不抖动）
        style={{ overflowAnchor: "none", scrollbarGutter: "stable" }}
      >
        <div ref={contentRef} className={cn("max-w-[820px] mx-auto py-3 pb-12", compact ? "px-3" : "px-1")}>
          <div key={conversationScrollKey} className="space-y-5 ux-fade">
            {/* 极轻提示：真正发生过旧对话压缩时（不显示 token 数字） */}
            {conversationSummary && (
              <div className="flex justify-center">
                <span
                  className="text-[10px] text-sandrift bg-[#F7F5F5] border border-line px-2 py-0.5 rounded-full"
                >
                  较早对话已压缩
                </span>
              </div>
            )}
            {messages.map((m, idx) => (
              // S-fix 长会话性能：行级 content-visibility（屏外跳过渲染，DOM 保留）；
              // wrapper 纯布局层，不干扰 Row memo（props 不变）与 space-y-5 rhythm
              <div key={m.id} className="kiro-conv-row">
                <KiroConversationRow
                  view={m}
                  allMessages={messages}
                  actionsReady={idx === lastAssistantIndex ? !turnInFlight : true}
                  sources={idx === lastAssistantIndex ? sources : undefined}
                  onUndo={onUndo}
                  onRetry={onRetry}
                  onEditUserMessage={onEditUserMessage}
                  // P4：live run 只标记最后一条 assistant 行（其他行保持稳定 props → memo 命中）
                  runLive={idx === lastAssistantIndex && turnInFlight}
                  questionAnswerable={idx === lastAssistantIndex && !turnInFlight && !m.restored}
                  approval={approvalBinding && m.id === approvalOwnerMessageId ? approvalBinding : undefined}
                  desktopPaused={idx === lastAssistantIndex ? desktopPaused : false}
                  onStop={onStop}
                  onReviewComputerTask={onReviewComputerTask}
                  onUndoComputerTask={onUndoComputerTask}
                  onApprovePlan={onApprovePlan}
                  onCancelPlan={onCancelPlan}
                  // 空终答追答只出现在 settled 的最后一条 assistant 行（显隐由 view 层判定）
                  showRegenerateAnswer={
                    !!m.needsAnswerRetry && idx === lastAssistantIndex && !turnInFlight
                  }
                  onRegenerateAnswer={onRegenerateAnswer}
                />
              </div>
            ))}

            {/* 首 token 前：Kiro Logo + 正在处理（Assistant 任一可见 part 出现后自动消失） */}
            {showPending && <KiroPendingIndicator />}

            {errorPresence.mounted && shownError && (
              <ExitCollapse exiting={!errorPresence.visible}>
              <div
                data-testid="kiro-error"
                className="kiro-structure-settle rounded-2xl bg-danger-bg border border-danger-border p-3.5 space-y-2"
              >
                <p className="text-xs font-bold text-danger">这次没能生成回复</p>
                <p className="text-[11px] text-satin-grey leading-relaxed">
                  {/* P0：友好文案优先（此前服务端透传的 provider 英文原串优先上屏，与中文语境断裂） */}
                  {AI_ERROR_MESSAGES[shownError.code] || shownError.message}
                </p>
                <div className="flex items-center gap-2 pt-0.5">
                  {/* P0：Key 错/模型下线时原样重试必败 → 隐藏重试，主按钮去设置 */}
                  {shownError.code !== "INVALID_API_KEY" && shownError.code !== "MODEL_NOT_FOUND" && (
                    <button
                      onClick={onRetry}
                      className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-bold text-white bg-charcoal hover:bg-black transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      重试
                    </button>
                  )}
                  {/* 超预算/超时：原样重试必然再败或需新起，给一键新建对话出口（provider 未传时不渲染） */}
                  {(shownError.code === "CONTEXT_TOO_LARGE" || shownError.code === "TIMEOUT") && onNewChat && (
                    <button
                      onClick={onNewChat}
                      className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-semibold text-satin-grey bg-surface border border-line hover:text-charcoal hover:border-line-strong transition-colors"
                    >
                      新建对话
                    </button>
                  )}
                  <button
                    onClick={onOpenSettings}
                    className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-semibold text-satin-grey bg-surface border border-line hover:text-charcoal hover:border-line-strong transition-colors"
                  >
                    <Settings className="w-3.5 h-3.5" />
                    打开设置
                  </button>
                </div>
              </div>
              </ExitCollapse>
            )}
          </div>
        </div>
      </div>

      {/* 用户上滑离开底部时：轻量「回到底部」浮钮（锚定 Conversation 可见区底部，不随消息滚动）。
          Motion V1：usePresence（enter fast / exit 同源 exit-fast；semantic hidden 立即 pointer-events-none；
          显隐类必须绑 visible 而非 open，否则挂载即终态、进入过渡永远播不出） */}
      {scrollBtnPresence.mounted && (
        <button
          ref={scrollBtnInertRef}
          onClick={scrollToBottom}
          aria-label="回到底部"
          aria-hidden={!showScrollBtn}
          className={cn(
            "absolute bottom-3 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-surface border border-line shadow-subtle flex items-center justify-center text-sandrift hover:text-charcoal hover:border-line-strong z-10",
            !scrollBtnPresence.visible && "pointer-events-none",
            scrollBtnPresence.visible
              ? cn("opacity-100 translate-x-[-50%] translate-y-0 scale-100 kiro-scroll-control-enter")
              : cn("opacity-0 translate-x-[-50%] translate-y-0.5 scale-95 kiro-scroll-control-exit")
          )}
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

/**
 * 单条消息行（Task 13）：React.memo + 自定义比较。
 * view 依赖 Message View 缓存（identity 稳定）→ streaming 时历史行不重渲染；
 * actionsReady/sources 对历史行是稳定原语；最后一行收到真实变化值。
 *
 * allMessages 特殊处理：chat.messages 每 token 都是新数组 identity，但内容 slice
 * （id 序列）不变时行输出不变 → 按 id 序列比较而非引用比较，否则 memo 恒穿透、
 * 流式每 token 全树 reconcile。编辑/重生成/恢复会改变 id 序列或 view 本体，照常更新。
 */
function sameMessageIdList(a?: KiroChatMessageView[], b?: KiroChatMessageView[]): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i].id !== b[i].id) return false;
  return true;
}

export interface KiroConversationRowProps {
  view: KiroChatMessageView;
  allMessages?: KiroChatMessageView[];
  actionsReady: boolean;
  sources?: KiroSourceMeta[];
  onUndo: (toolCallId: string) => void;
  onRetry: () => void;
  onEditUserMessage: (messageId: string, text: string) => Promise<boolean>;
  /** P4：本行是 live run（最后一条 assistant 且 turn 进行中） */
  runLive: boolean;
  /** Agent Superpowers：本行是最后一条 assistant 且 turn 已结算 → Ask Card 可回答 */
  questionAnswerable?: boolean;
  /** P4：属于本行的 Inline Approval（taskId 精确匹配） */
  approval?: KiroAgentRunApprovalBinding;
  desktopPaused?: boolean;
  onStop?: () => void;
  onReviewComputerTask?: (taskId: string) => void;
  onUndoComputerTask?: (taskId: string) => void;
  /** plan-approve：批准 / 取消执行计划（卡片入口） */
  onApprovePlan?: (planId: string) => void;
  onCancelPlan?: (planId: string) => void;
  /** 空终答追答按钮显隐（父行已按 settled 末条 + 空终答判定，仅布尔保 memo） */
  showRegenerateAnswer?: boolean;
  /** 空终答追答（纯文本重跑；零工具） */
  onRegenerateAnswer?: () => void;
}

export function areConversationRowsEqual(prev: KiroConversationRowProps, next: KiroConversationRowProps): boolean {
  if (!sameMessageIdList(prev.allMessages, next.allMessages)) return false;
  const prevRest = prev as unknown as Record<string, unknown>;
  const nextRest = next as unknown as Record<string, unknown>;
  for (const key of Object.keys(prevRest)) {
    if (key === "allMessages") continue;
    if (!Object.is(prevRest[key], nextRest[key])) return false;
  }
  return Object.keys(nextRest).every((key) => key === "allMessages" || key in prevRest);
}

const KiroConversationRow = React.memo(function KiroConversationRow({
  view,
  allMessages,
  actionsReady,
  sources,
  onUndo,
  onRetry,
  onEditUserMessage,
  runLive,
  questionAnswerable,
  approval,
  desktopPaused,
  onStop,
  onReviewComputerTask,
  onUndoComputerTask,
  onApprovePlan,
  onCancelPlan,
  showRegenerateAnswer,
  onRegenerateAnswer,
}: KiroConversationRowProps) {
  // Hooks 必须在 assistant 占位由空变为可见内容前后保持同一顺序。
  const actionSummaries = React.useMemo(
    () => [
      ...(view.actions ?? []).map((a) => actionSummaryText(actionToCardProps(a.action))),
      ...(view.historyActions ?? []).map((a) => actionSummaryText(a as Parameters<typeof actionSummaryText>[0])),
    ],
    [view]
  );
  const actionIds = React.useMemo(
    () => (view.actions ?? []).map((action) => action.toolCallId),
    [view.actions]
  );
  const enteringActionIds = useEnterOnAdd(actionIds);
  const [skillDistillOpen, setSkillDistillOpen] = React.useState(false);
  const [skillTrace, setSkillTrace] = React.useState<WorkflowTrace | null>(null);

  if (view.role === "user") {
    return (
      // V4.6：live transcript 不使用 message-level animate-enter（事件到达即展示）
      <div>
        <KiroUserMessage
          messageId={view.id}
          content={view.content}
          attachments={view.attachments}
          canEdit={view.canEdit}
          editDisabledReason={view.editDisabledReason}
          onEdit={onEditUserMessage}
        />
      </div>
    );
  }
  // 空 assistant（pre-response 占位）：同一 message id 的 shell 先显示「正在准备」，
  // 之后 worklog/content 到达只替换 body——outer shell（KiroMark + 左侧 column）不 remount。
  // 只要存在任一可见内容（final answer / worklog / action / computer task）就渲染消息行。
  const hasWorklog = (view.assistantTurn?.worklog.length ?? 0) > 0;
  const hasComputerTask = Boolean(view.computerTask || view.historyComputerTask);
  const hasExecutionPlan = (view.executionPlans?.length ?? 0) > 0;
  if (
    !view.content &&
    !hasWorklog &&
    !view.actions?.length &&
    !view.historyActions?.length &&
    !hasComputerTask &&
    !hasExecutionPlan
  ) {
    // P0：settled/已停止的空行不再转圈（此前 Stop 后无可见 part 仍显示“正在准备”+spin，用户以为还在跑）
    if (!runLive) {
      return (
        <KiroAssistantShell testid="kiro-assistant-pending" messageId={view.id}>
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-sandrift">已停止，未生成内容</span>
          </div>
        </KiroAssistantShell>
      );
    }
    return (
      <KiroAssistantShell testid="kiro-assistant-pending" messageId={view.id}>
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-charcoal">正在准备</span>
          <Loader2 className="w-3.5 h-3.5 animate-spin text-sandrift shrink-0" aria-hidden="true" />
        </div>
      </KiroAssistantShell>
    );
  }

  return (
    // V4.6：live transcript 不使用 message-level animate-enter（事件到达即展示）
    <div>
      <KiroMessage
        messageId={view.id}
        content={view.content}
        streaming={view.streaming}
        canRegenerate={view.canRegenerate}
        actionsReady={actionsReady}
        sources={view.sources ?? sources}
        actionSummaries={actionSummaries}
        assistantTurn={view.assistantTurn}
        computerTask={view.computerTask}
        historyComputerTask={view.historyComputerTask}
        historyTaskCanUndo={view.historyTaskCanUndo}
        executionPlans={view.executionPlans}
        onApprovePlan={onApprovePlan}
        onCancelPlan={onCancelPlan}
        showRegenerateAnswer={showRegenerateAnswer}
        onRegenerateAnswer={onRegenerateAnswer}
        approval={approval}
        turnInFlight={runLive}
        questionAnswerable={questionAnswerable}
        desktopPaused={desktopPaused}
        onStop={onStop}
        onReviewComputerTask={onReviewComputerTask}
        onUndoComputerTask={onUndoComputerTask}
        onRetry={onRetry}
      >
        {/* Action Result Cards：真实 ToolResult 事实 UI */}
        {view.actions && view.actions.length > 0 && (
          <div className="space-y-2.5 pt-1">
            {view.actions.map((a) => (
              <KiroActionCard
                key={a.toolCallId}
                {...actionToCardProps(a.action)}
                entering={enteringActionIds.has(a.toolCallId)}
                onUndo={a.action.canUndo ? () => onUndo(a.toolCallId) : undefined}
              />
            ))}
          </div>
        )}
        {view.actions && view.actions.length > 0 && actionsReady && !view.streaming && (() => {
          const trace = allMessages ? extractWorkflowTraceForTurn(allMessages as never, { assistantMessageId: view.id }) : null;
          const reusable = trace ? isWorkflowTraceReusable(trace) : false;
          if (!reusable || !trace) return null;
          return (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => {
                  setSkillTrace(trace);
                  setSkillDistillOpen(true);
                }}
                data-testid="save-workflow-as-skill"
                className="h-8 px-4 bg-charcoal text-white text-xs font-bold rounded-lg hover:bg-black flex items-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" />
                将这套流程保存为 Skill
              </button>
            </div>
          );
        })()}
        {/* 历史恢复的 Action Cards：纯展示事实（canUndo 恒 false） */}
        {view.historyActions && view.historyActions.length > 0 && (
          <div className="space-y-2.5 pt-1">
            {view.historyActions.map((a) => (
              <KiroActionCard
                key={a.toolCallId}
                variant={a.variant as KiroActionCardVariant}
                heading={a.heading}
                title={a.title}
                change={a.change ?? undefined}
                bullets={a.bullets}
                footer={a.footer}
                details={a.details}
              />
            ))}
          </div>
        )}
        {/* Study Plan Proposal Card（真实 ToolResult 事实 UI；仅 live 轮次，历史恢复不渲染） */}
        <DisclosureRegion open={!!view.proposals && view.proposals.length > 0 && !view.streaming}>
          {view.proposals && view.proposals.length > 0 && !view.streaming ? (
            <StudyPlanProposalCard proposals={view.proposals} />
          ) : null}
        </DisclosureRegion>
        {/* Study Rebalance Proposal Card（Part 5；真实 ToolResult 事实 UI；仅 live 轮次） */}
        <DisclosureRegion open={!!view.rebalanceProposals && view.rebalanceProposals.length > 0 && !view.streaming}>
          {view.rebalanceProposals && view.rebalanceProposals.length > 0 && !view.streaming ? (
            <StudyRebalanceProposalCard proposals={view.rebalanceProposals} />
          ) : null}
        </DisclosureRegion>
        {/* Task Breakdown Proposal Card（真实 ToolResult 事实 UI；仅 live 轮次） */}
        <DisclosureRegion open={!!view.breakdowns && view.breakdowns.length > 0 && !view.streaming}>
          {view.breakdowns && view.breakdowns.length > 0 && !view.streaming ? (
            <TaskBreakdownProposalCard proposals={view.breakdowns} />
          ) : null}
        </DisclosureRegion>
        {/* Visual Action Intake Proposal Card（真实 ToolResult 事实 UI；仅 live Proposal） */}
        <DisclosureRegion
          open={!!view.visualActionProposals && view.visualActionProposals.length > 0 && !view.streaming}
        >
          {view.visualActionProposals && view.visualActionProposals.length > 0 && !view.streaming ? (
          <div className="space-y-2.5 pt-1">
            {view.visualActionProposals.map((p) => (
              // V1.5：Conversation 层解析 live 来源（sourceAttachmentIds → runtime File lookup；
              // Card 不扫描全局 Store；历史恢复后 registry 为空 → 自然降级）
              <VisualActionProposalCard
                key={p.id}
                proposal={p}
                sourceAttachments={resolveLiveImageSources(p.sourceAttachmentIds)}
              />
            ))}
          </div>
          ) : null}
        </DisclosureRegion>
        {/* Visual Timetable Import Proposal Card（课表初始化导入；独立于 Visual Action Intake） */}
        <DisclosureRegion
          open={!!view.timetableImportProposals && view.timetableImportProposals.length > 0 && !view.streaming}
        >
          {view.timetableImportProposals && view.timetableImportProposals.length > 0 && !view.streaming ? (
            <div className="space-y-2.5 pt-1">
              {view.timetableImportProposals.map((p) => (
                <TimetableImportProposalCard key={p.id} proposal={p} />
              ))}
            </div>
          ) : null}
        </DisclosureRegion>
        {/* Visual Intake V1.3：历史只读 Proposal 快照（display-only；绝不交叉到 live Card；
            与 live 卡片同 Disclosure 语义，此前裸 ux-fade 与 live 动效语言不一致） */}
        <DisclosureRegion
          open={!!view.historyVisualActionProposals && view.historyVisualActionProposals.length > 0}
        >
          {view.historyVisualActionProposals && view.historyVisualActionProposals.length > 0 ? (
            <div className="space-y-2.5 pt-1 ux-fade">
              {view.historyVisualActionProposals.map((p) => (
                <VisualActionProposalHistoryCard key={p.id} proposal={p} />
              ))}
            </div>
          ) : null}
        </DisclosureRegion>
      </KiroMessage>
      <SkillDistillDialog open={skillDistillOpen} onOpenChange={setSkillDistillOpen} trace={skillTrace} />
    </div>
  );
}, areConversationRowsEqual);

function isVisibleConversationMessage(message: KiroChatMessageView): boolean {
  if (message.role === "user") return true;
  return Boolean(
    message.content ||
      message.assistantTurn?.worklog.length ||
      message.actions?.length ||
      message.historyActions?.length ||
      message.computerTask ||
      message.historyComputerTask ||
      // plan-approve：纯计划消息（模型只调 propose 无正文）同样可见
      message.executionPlans?.length
  );
}
