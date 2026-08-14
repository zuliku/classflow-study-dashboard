"use client";

import React from "react";
import { ShieldAlert } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { ComputerApprovalRequest, ComputerApprovalDecision } from "@/lib/ai/computer/approval";

const DECISION_LABELS: Record<ComputerApprovalDecision, string> = {
  deny: "拒绝",
  "allow-once": "允许这一次",
  "allow-session": "本次会话允许",
  "allow-workspace": "此 Workspace 始终允许",
};

const DECISION_VARIANTS: Record<ComputerApprovalDecision, "danger" | "primary" | "secondary" | "accent"> = {
  deny: "danger",
  "allow-once": "primary",
  "allow-session": "secondary",
  "allow-workspace": "accent",
};

/**
 * Computer Approval Dialog（Part 3）：专门审批 UI（不复用 ConfirmDialog）。
 * - 只显示 request.allowedDecisions 允许的选项（ask → allow 的合法路径）。
 * - 只展示安全逻辑资源（workspace/root/relativePath），绝无 native path / adapterRef / handle。
 * - 没有 Tool Output；决策后由 useKiroChat resume 同一条 exact call。
 */
export function ComputerApprovalDialog({
  request,
  onDecision,
}: {
  request: ComputerApprovalRequest | null;
  onDecision: (approvalId: string, decision: ComputerApprovalDecision) => void;
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

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      overlayId="kiro-computer-approval"
      stackZ={80}
      closeOnBackdrop={false}
      className="max-w-md"
    >
      <div data-testid="kiro-approval-dialog" className="p-4 space-y-3.5">
        <div className="flex items-start gap-2.5">
          <span className="w-8 h-8 rounded-full bg-pastel-mint/60 flex items-center justify-center shrink-0">
            <ShieldAlert className="w-4 h-4 text-charcoal" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-charcoal">Kiro 请求文件权限</h2>
            {request && (
              <p className="text-xs font-semibold text-satin-grey mt-1 leading-relaxed">
                {request.description}
              </p>
            )}
          </div>
        </div>

        {request && (
          <div className="rounded-xl border border-line bg-[#F7F5F5] p-3 space-y-1.5">
            <p className="text-[11px] text-charcoal font-bold">
              {request.resourceLabel}
            </p>
            <p className="text-[10px] text-sandrift">
              {request.workspaceLabel}
              {request.rootLabel ? ` / ${request.rootLabel}` : ""}
            </p>
            <p className="text-[10px] text-sandrift">
              {request.capability === "fs.modify" || request.capability === "document.modify"
                ? "修改操作"
                : request.capability === "fs.create" || request.capability === "document.create"
                  ? "创建操作"
                  : "文件操作"}
            </p>
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
              {DECISION_LABELS[d]}
            </Button>
          ))}
        </div>

        <p className="text-[10px] text-sandrift leading-relaxed">
          权限审批只能放行本应确认的操作，不会突破工作区沙箱与只读边界。
        </p>
      </div>
    </Dialog>
  );
}
