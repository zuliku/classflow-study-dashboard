"use client";

import React, { useRef, useState } from "react";
import { KiroAssistantTurnPresentation } from "@/lib/ai/presentation/turnPresentation";
import { KiroAgentTask } from "@/lib/ai/computer/task";
import { ComputerApprovalDecision, ComputerApprovalRequest } from "@/lib/ai/computer/approval";
import {
  formatKiroAgentRunDuration,
  resolveKiroAgentRunStatus,
} from "@/lib/ai/ui/kiroAgentRun";
import { KiroAgentRunHeader } from "@/components/kiro/run/KiroAgentRunHeader";
import { KiroWorklogTimeline } from "@/components/kiro/KiroWorklog";
import { KiroInlineApproval } from "@/components/kiro/run/KiroInlineApproval";

/** 审批绑定（由 Conversation 层按 taskId 精确匹配后注入；未匹配 → orphan fallback Dialog） */
export interface KiroAgentRunApprovalBinding {
  request: ComputerApprovalRequest;
  queueLength: number;
  onDecision: (approvalId: string, decision: ComputerApprovalDecision) => void;
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
  onStop,
}: {
  assistantTurn: KiroAssistantTurnPresentation;
  /** owning Computer Task（live；历史任务不参与 Run 状态） */
  computerTask?: KiroAgentTask;
  /** 属于本 Run 的审批（taskId 已精确匹配） */
  approval?: KiroAgentRunApprovalBinding | null;
  turnInFlight: boolean;
  desktopPaused?: boolean;
  onStop?: () => void;
}) {
  const hasWorklog = assistantTurn.worklog.length > 0 || !!assistantTurn.reasoningSummary;

  // 当前 Turn：working/composing/answering 保持 expanded；历史恢复（初始 done）默认折叠；
  // 不因 done 瞬时 collapse（避免完成瞬间 layout 跳动）；用户手动操作始终优先。
  const [expanded, setExpanded] = useState(
    assistantTurn.phase === "working" ||
      assistantTurn.phase === "composing" ||
      assistantTurn.phase === "answering"
  );
  const userToggledRef = useRef(false);

  if (!hasWorklog) return null;

  const status = resolveKiroAgentRunStatus({
    turnInFlight,
    phase: assistantTurn.phase,
    taskStatus: computerTask?.status,
    waitingApproval: !!approval,
    desktopPaused,
  });

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
        expanded={expanded}
        onToggle={toggleExpanded}
        onStop={onStop}
      />

      <KiroWorklogTimeline
        worklog={assistantTurn.worklog}
        phase={assistantTurn.phase}
        reasoningSummary={assistantTurn.reasoningSummary}
        expanded={expanded}
      />

      {/* Inline Approval：Timeline 后、Final Answer 前；折叠 Timeline 也始终可见 */}
      {approval && (
        <KiroInlineApproval
          request={approval.request}
          queueLength={approval.queueLength}
          onDecision={approval.onDecision}
        />
      )}
    </div>
  );
}
