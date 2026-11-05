"use client";

import React from "react";
import { ShieldAlert } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { ComputerApprovalRequest, ComputerApprovalDecision } from "@/lib/ai/computer/approval";
import {
  COMPUTER_APPROVAL_DECISION_HINTS,
  COMPUTER_APPROVAL_DECISION_LABELS,
  getComputerApprovalPresentation,
} from "@/lib/ai/ui/computerApprovalPresentation";
import { ApprovalCountdown } from "@/components/kiro/run/ApprovalCountdown";

const DECISION_VARIANTS: Record<ComputerApprovalDecision, "danger" | "primary" | "secondary" | "accent"> = {
  deny: "danger",
  "allow-once": "primary",
  "allow-session": "secondary",
  "allow-workspace": "accent",
};

/**
 * Fallback Approval Dialog（P4 §11/§41）：
 *
 * 正常情况下 pendingApproval 通过真实 taskId 精确匹配到 owning Computer Task → owning
 * assistant row 内的 Inline Approval（KiroInlineApproval），不出现任何 Modal。
 *
 * 本 Dialog 只在 orphan / transition edge case 使用：assistant row 尚未建立、
 * conversation 切换 / 恢复竞态、unexpected runtime state——审批必须始终有地方可操作。
 *
 * - 与 Inline Approval 共用 computerApprovalPresentation（文案不漂移）；
 * - 只显示 request.allowedDecisions 允许的选项；绝不扩大 Approval 范围；
 * - 只展示安全逻辑资源（workspace/root/relativePath），绝无 native path / adapterRef / handle；
 * - 没有 Tool Output；决策后由 useKiroChat resume 同一条 exact call。
 */
export function ComputerApprovalDialog({
  request,
  queueLength,
  onDecision,
  onBulkDecision,
}: {
  request: ComputerApprovalRequest | null;
  queueLength?: number;
  onDecision: (approvalId: string, decision: ComputerApprovalDecision) => void;
  onBulkDecision?: (decision: ComputerApprovalDecision) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const open = request !== null;

  // V2.7：busy 绑定 approval ID 生命周期——新 approval（含队列下一条）必须可点击，
  // 防止 busy=true 从上一个 request 永久继承导致审批 UI 卡死。
  React.useEffect(() => {
    setBusy(false);
  }, [request?.id]);

  const decide = (decision: ComputerApprovalDecision) => {
    if (!request || busy) return;
    setBusy(true);
    // 允许 UI 先进入忙态；决策处理是 async（resume），但对话框立即关闭
    onDecision(request.id, decision);
  };

  const handleOpenChange = (next: boolean) => {
    // 不允许用户直接关掉未决审批（必须做出决定）
    if (!next) return;
  };

  const presentation = request ? getComputerApprovalPresentation(request) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      overlayId="kiro-computer-approval"
      stackZ={80}
      closeOnBackdrop={false}
      className="max-w-md max-h-[min(90dvh,calc(100dvh-var(--titlebar-h)-24px))] flex flex-col"
    >
      <div data-testid="kiro-approval-dialog" className="p-4 space-y-3.5 min-h-0 flex-1 overflow-y-auto">
        <div className="flex items-start gap-2.5">
          <span className="w-8 h-8 rounded-full bg-pastel-mint/60 flex items-center justify-center shrink-0">
            <ShieldAlert className="w-4 h-4 text-charcoal" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-charcoal">{presentation?.title ?? "Kiro 操作确认"}</h2>
            {request && (
              <p className="text-xs font-semibold text-satin-grey mt-1 leading-relaxed">
                {request.description}
              </p>
            )}
          </div>
        </div>

        {presentation && (
          <div className="rounded-xl border border-line bg-[#F7F5F5] p-3 space-y-1.5">
            <p className="text-[11px] text-charcoal font-bold break-words">{presentation.primary}</p>
            {presentation.meta.map((line) => (
              <p key={line} className="text-[10px] text-sandrift truncate">
                {line}
              </p>
            ))}
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
          </div>
        )}

        <div className="flex flex-col gap-1.5 pt-0.5">
          {request?.allowedDecisions.map((d) => (
            <Button
              key={d}
              variant={DECISION_VARIANTS[d]}
              size="sm"
              className="w-full justify-center"
              disabled={busy}
              onClick={() => decide(d)}
              data-testid={`approval-${d}`}
            >
              {COMPUTER_APPROVAL_DECISION_LABELS[d]}
            </Button>
          ))}
          {queueLength !== undefined && queueLength > 1 && onBulkDecision && (
            <Button
              variant="secondary"
              size="sm"
              className="w-full justify-center mt-1"
              disabled={busy}
              onClick={() => {
                if (!request || busy) return;
                setBusy(true);
                onBulkDecision("allow-once");
              }}
              data-testid="approval-bulk-allow-once"
            >
              批量允许这一次（{queueLength} 项）
            </Button>
          )}
        </div>

        <p className="text-[10px] text-sandrift leading-relaxed">
          {request?.gui
            ? "只执行你批准的动作；敏感信息不会由 Kiro 输入。"
            : "只放行本应确认的操作，不改变工作区权限边界。"}
        </p>
        {/* S-fix：3 分钟超时倒计时（与 Inline 共用同一 store deadline） */}
        <ApprovalCountdown />
      </div>
    </Dialog>
  );
}
