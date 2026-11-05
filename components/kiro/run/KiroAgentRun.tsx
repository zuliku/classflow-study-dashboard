"use client";

import React, { useRef, useState } from "react";
import { KiroAssistantTurnPresentation } from "@/lib/ai/presentation/turnPresentation";
import { KiroAgentTask } from "@/lib/ai/computer/task";
import { ComputerApprovalDecision, ComputerApprovalRequest } from "@/lib/ai/computer/approval";
import {
  formatKiroAgentRunDuration,
  resolveKiroAgentRunActiveLabel,
  resolveKiroAgentRunStatus,
} from "@/lib/ai/ui/kiroAgentRun";
import { KiroAgentRunHeader } from "@/components/kiro/run/KiroAgentRunHeader";
import { KiroWorklogTimeline } from "@/components/kiro/KiroWorklog";
import { KiroInlineApproval } from "@/components/kiro/run/KiroInlineApproval";
import { KiroAgentPlanCard } from "@/components/kiro/run/KiroAgentPlanCard";
import { KiroAskUserCard } from "@/components/kiro/run/KiroAskUserCard";
import { ExitCollapse } from "@/components/ui/ExitCollapse";
import { usePresence } from "@/lib/usePresence";
import { MOTION_EXIT_MS } from "@/lib/motion";

/** 审批绑定（由 Conversation 层按 taskId 精确匹配后注入；未匹配 → orphan fallback Dialog） */
export interface KiroAgentRunApprovalBinding {
  request: ComputerApprovalRequest;
  queueLength: number;
  onDecision: (approvalId: string, decision: ComputerApprovalDecision) => void;
  onBulkDecision?: (decision: ComputerApprovalDecision) => void;
}

/** GUI 工具（用于「正在操作电脑」Header 文案） */
const DESKTOP_TOOL_NAMES = new Set(["desktop_action", "observe_desktop"]);

/**
 * Kiro Agent Run（P4）：Assistant Turn 内 canonical execution presentation。
 *
 * 结构：
 *   Agent Run Header（状态 + disclosure + Stop）
 *   Worklog Timeline（canonical Agent trace；绝不重写 derivation）
 *   Inline Approval（Timeline 后、Final Answer 前；绝不放进 Disclosure）
 *
 * - 状态由 resolveKiroAgentRunStatus 纯推导（Runtime fact → status，绝不反向 set）；
 * - Final Answer 与 execution 是不同 lane：本组件不包裹 Final Answer；
 * - 运行中默认展开；完成瞬间不强制折叠（无 layout jump）；历史恢复默认折叠；
 * - 用户手动折叠后，待确认 Approval 仍必须可见（Approval 在 Disclosure 之外）。
 */
export function KiroAgentRun({
  assistantTurn,
  computerTask,
  approval,
  turnInFlight,
  desktopPaused,
  questionAnswerable,
  onStop,
}: {
  assistantTurn: KiroAssistantTurnPresentation;
  /** owning Computer Task（live；历史任务不参与 Run 状态） */
  computerTask?: KiroAgentTask;
  /** 属于本 Run 的审批（taskId 已精确匹配） */
  approval?: KiroAgentRunApprovalBinding | null;
  turnInFlight: boolean;
  desktopPaused?: boolean;
  /** 本消息是最后一条 assistant 且当前无进行中的 turn → Ask Card 可回答 */
  questionAnswerable?: boolean;
  onStop?: () => void;
}) {
  const hasWorklog =
    assistantTurn.worklog.length > 0 ||
    !!assistantTurn.reasoningSummary ||
    !!assistantTurn.plan ||
    !!assistantTurn.question;

  // 当前 Turn：working 保持 expanded；回答 lane（composing/answering）默认收起（V5 focus）；
  // 历史恢复（初始 done）默认折叠；不因 done 瞬时 collapse（避免完成瞬间 layout 跳动）；
  // 用户手动操作始终优先。
  const [expanded, setExpanded] = useState(assistantTurn.phase === "working");
  const userToggledRef = useRef(false);

  // Plan 退出 presence：plan 被新状态替换/清空时仍播放收起，不硬切顶起 Final Answer。
  const planPresence = usePresence(!!assistantTurn.plan, MOTION_EXIT_MS.panel);
  const lastPlanRef = useRef(assistantTurn.plan);
  if (assistantTurn.plan) lastPlanRef.current = assistantTurn.plan;

  // P0 hooks order：usePresence / useRef 必须在 `if (!hasWorklog) return null` 之前，
  // 否则「历史无 worklog → live 出现 worklog」时 hooks 数量变化会整页崩溃
  // （Rendered fewer hooks than expected；长历史恢复后继续对话可复现）。
  const approvalPresence = usePresence(!!approval, MOTION_EXIT_MS.panel);
  const lastApprovalRef = React.useRef(approval);
  if (approval) lastApprovalRef.current = approval;
  const shownApproval = approval ?? (approvalPresence.mounted ? lastApprovalRef.current : null);

  // Streaming UX V5：回答 lane 开始 → 自动收起执行轨迹（ChatGPT/Claude 的 focus 行为）。
  // - 用户手动 toggle 永远优先；
  // - 若 provisional answer 后来被降级回 commentary（working），恢复展开；
  // - 完成（done）不强制折叠，保留既有「完成瞬间无 layout jump」契约。
  const autoCollapsedForAnswerRef = React.useRef(false);
  React.useEffect(() => {
    if (userToggledRef.current) return;
    const answerLane =
      assistantTurn.phase === "composing" || assistantTurn.phase === "answering";
    if (answerLane) {
      if (!autoCollapsedForAnswerRef.current) {
        autoCollapsedForAnswerRef.current = true;
        setExpanded(false);
      }
    } else if (assistantTurn.phase === "working" && autoCollapsedForAnswerRef.current) {
      autoCollapsedForAnswerRef.current = false;
      setExpanded(true);
    }
  }, [assistantTurn.phase]);

  // plan 退出期间仍保留 Run 外壳，直到 ExitCollapse 播完。
  if (!hasWorklog && !planPresence.mounted) return null;

  const status = resolveKiroAgentRunStatus({
    turnInFlight,
    phase: assistantTurn.phase,
    taskStatus: computerTask?.status,
    waitingApproval: !!approval,
    desktopPaused,
  });

  // Streaming UX V5：running 时展示真实 working Tool 的公开语义动作（不含 input/output）
  const activeToolLabel =
    status === "running" ? resolveKiroAgentRunActiveLabel(assistantTurn.worklog) : null;

  // GUI 操作进行中 → 「正在操作电脑」（Computer Session 事实；扫描小数组，不进 hot path 之外）
  const desktopActive =
    status === "running" &&
    assistantTurn.worklog.some(
      (block) =>
        block.kind === "tool" && block.status === "working" && DESKTOP_TOOL_NAMES.has(block.toolName)
    );

  const durationLabel =
    status === "completed"
      ? formatKiroAgentRunDuration(computerTask ?? {}) ?? undefined
      : undefined;

  const toggleExpanded = () => {
    userToggledRef.current = true;
    setExpanded((value) => !value);
  };

  return (
    <div data-testid="kiro-agent-run" className="space-y-1 min-w-0 w-full">
      <KiroAgentRunHeader
        status={status}
        durationLabel={durationLabel}
        desktopActive={desktopActive}
        activeToolLabel={activeToolLabel}
        reasoning={!!assistantTurn.reasoningSummary}
        answering={assistantTurn.phase === "answering"}
        collapsible={assistantTurn.worklog.length > 0}
        expanded={expanded}
        onToggle={toggleExpanded}
        onStop={onStop}
      />

      {planPresence.mounted && lastPlanRef.current && (
        <ExitCollapse exiting={!planPresence.visible}>
          <KiroAgentPlanCard plan={lastPlanRef.current} running={turnInFlight} />
        </ExitCollapse>
      )}

      <KiroWorklogTimeline
        worklog={assistantTurn.worklog}
        phase={assistantTurn.phase}
        expanded={expanded}
      />

      {assistantTurn.question && (
        <KiroAskUserCard
          question={assistantTurn.question}
          answerable={!!questionAnswerable}
        />
      )}

      {/* Inline Approval：Timeline 后、Final Answer 前；折叠 Timeline 也始终可见 */}
      {shownApproval && (
        <ExitCollapse exiting={!approvalPresence.visible}>
          <KiroInlineApproval
            request={shownApproval.request}
            queueLength={shownApproval.queueLength}
            onDecision={shownApproval.onDecision}
            onBulkDecision={shownApproval.onBulkDecision}
          />
        </ExitCollapse>
      )}
    </div>
  );
}
