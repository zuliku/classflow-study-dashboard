"use client";

import React from "react";
import { ComputerApprovalDecision, ComputerApprovalRequest } from "@/lib/ai/computer/approval";
import {
  COMPUTER_APPROVAL_DECISION_HINTS,
  COMPUTER_APPROVAL_DECISION_LABELS,
  getComputerApprovalPresentation,
} from "@/lib/ai/ui/computerApprovalPresentation";
import { ApprovalCountdown } from "@/components/kiro/run/ApprovalCountdown";
import { cn } from "@/lib/utils";

/**
 * Kiro Inline Approval（P4）：Agent Run Timeline 后、Final Answer 前的审批区域。
 *
 * 契约：
 * - 只消费 request.allowedDecisions 生成按钮（绝不自行增加 allow-session / allow-workspace）；
 * - 只使用 computerApprovalPresentation 的脱敏文案（无 native path / elementId / HWND / PID / id）；
 * - busy 绑定 approval.id 生命周期：决策后立即 disable；request.id 变化（队列下一条）→ 恢复可交互；
 * - Esc 不 dismiss、不 approve（用户必须明确拒绝或允许）；Enter/Space 只在聚焦按钮上生效；
 * - 审批是 blocking 事实，绝不放进 DisclosureRegion（折叠 Timeline 不影响可见性）。
 */
export function KiroInlineApproval({
  request,
  queueLength,
  onDecision,
  onBulkDecision,
}: {
  request: ComputerApprovalRequest;
  queueLength?: number;
  onDecision: (approvalId: string, decision: ComputerApprovalDecision) => void;
  /** 队列批量允许（与 fallback Dialog 同语义；缺失则不渲染批量键） */
  onBulkDecision?: (decision: ComputerApprovalDecision) => void;
}) {
  const [busy, setBusy] = React.useState(false);

  // 新 approval（含队列下一条）必须可点击：busy 不跨 request 继承
  React.useEffect(() => {
    setBusy(false);
  }, [request.id]);

  const decide = (decision: ComputerApprovalDecision) => {
    if (busy) return;
    setBusy(true);
    onDecision(request.id, decision);
  };

  const presentation = getComputerApprovalPresentation(request);
  const remaining = Math.max(0, (queueLength ?? 1) - 1);

  return (
    <section
      data-testid="kiro-inline-approval"
      role="group"
      aria-label="Kiro 操作确认"
      // 审批出现需要引起注意：轻进入（只进不出——退出延迟会拖慢阻塞决策链）
      className="border-y border-line-strong py-2.5 space-y-2 min-w-0 animate-enter"
    >
      <div aria-live="polite">
        <p className="text-[11px] font-bold text-charcoal">{presentation.title}</p>
        <p className="text-xs font-semibold text-charcoal mt-0.5 break-words">
          {presentation.primary}
        </p>
        {presentation.meta.map((line) => (
          <p key={line} className="text-[10px] text-sandrift truncate">
            {line}
          </p>
        ))}
      </div>

      {presentation.command && (
        <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-charcoal bg-white border border-line rounded-lg px-2 py-1.5 max-h-40 overflow-y-auto">
          {presentation.command}
        </pre>
      )}
      {presentation.textPreview && (
        <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-charcoal bg-white border border-line rounded-lg px-2 py-1.5 max-h-24 overflow-y-auto">
          {presentation.textPreview}
        </pre>
      )}

      {presentation.warnings.map((warning) => (
        <p key={warning} className="text-[10px] font-semibold text-danger">
          {warning}
        </p>
      ))}

      {remaining > 0 && (
        <p className="text-[10px] text-sandrift">还有 {remaining} 项等待确认</p>
      )}

      {/* S-fix：3 分钟超时倒计时（deadline 由超时 effect 写入 store；无 deadline 不渲染） */}
      <ApprovalCountdown />

      {/* 只渲染 Runtime 允许的决策；窄容器（Sidecar）自动纵向排列 */}
      <div className="flex flex-col gap-1.5 sm:flex-row sm:justify-end">
        {request.allowedDecisions.map((decision) => (
          <button
            key={decision}
            type="button"
            data-testid={`approval-${decision}`}
            disabled={busy}
            onClick={() => decide(decision)}
            title={COMPUTER_APPROVAL_DECISION_HINTS[decision]}
            className={cn(
              "h-8 px-3 rounded-lg text-[11px] font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
              decision === "deny"
                ? "border border-danger-border text-danger hover:bg-danger-bg"
                : decision === "allow-once"
                  ? "bg-charcoal text-white hover:bg-black"
                  : "border border-line-strong bg-surface text-charcoal hover:border-charcoal"
            )}
          >
            {COMPUTER_APPROVAL_DECISION_LABELS[decision]}
          </button>
        ))}
        {/* P0：队列批量键（此前 Inline 无批量，5 个文件改动连点 5 次倒计时；仅 allow-once 全允许时出现） */}
        {(queueLength ?? 1) > 1 && onBulkDecision && request.allowedDecisions.includes("allow-once") && (
          <button
            type="button"
            data-testid="approval-bulk-allow-once"
            disabled={busy}
            onClick={() => {
              if (busy) return;
              setBusy(true);
              onBulkDecision("allow-once");
            }}
            title="队列中剩余审批一次全部允许（仅本次操作有效）"
            className="h-8 px-3 rounded-lg text-[11px] font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-line-strong bg-surface text-charcoal hover:border-charcoal"
          >
            批量允许这一次（{queueLength} 项）
          </button>
        )}
      </div>
    </section>
  );
}
