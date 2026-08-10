"use client";

import React, { useMemo, useRef, useState } from "react";
import { Check, ClipboardList, RefreshCcw, X } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { useConfirmStore } from "@/store/useConfirmStore";
import {
  applyTaskBreakdown,
  ApplyBreakdownMode,
  parseTaskBreakdownProposal,
  TaskBreakdownProposal,
} from "@/lib/tasks/taskBreakdown";
import { formatEstimatedMinutes } from "@/lib/tasks/taskSemantics";
import { cn } from "@/lib/utils";

/**
 * Kiro Task Breakdown Proposal Card（Part C）：
 * 渲染 propose_task_breakdown 的真实结构化结果（模型生成 → schema 校验 → 事实 UI）。
 * - 只展示建议；Apply 前绝不写入 Subtasks / estimatedMinutes
 * - 已有 Subtasks → 确认弹窗显式选择 追加（默认）/ 替换；替换为 danger 级确认
 * - 预计耗时独立 checkbox（默认勾选）；已有估时显示「X → Y（AI 估计）」不静默覆盖
 * - submitted / completed 任务 Apply 禁用（防止把状态改回待完成）
 * - Apply 后 Toast 撤销恢复完整快照（Subtasks / estimatedMinutes / progress / status）
 */
export function TaskBreakdownProposalCard({ proposals }: { proposals: TaskBreakdownProposal[] }) {
  const [dismissed, setDismissed] = useState(false);
  const valid = useMemo(
    () => proposals.filter((p) => parseTaskBreakdownProposal(p) !== null),
    [proposals]
  );

  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const [revokedIds, setRevokedIds] = useState<Set<string>>(new Set());
  const [staleIds, setStaleIds] = useState<Set<string>>(new Set());
  const undoRef = useRef<Map<string, () => void>>(new Map());
  const optionsRef = useRef<{ mode: ApplyBreakdownMode; applyEstimate: boolean }>({
    mode: "append",
    applyEstimate: true,
  });

  const assignments = useAppStore((s) => s.assignments);
  const pushToast = useToastStore((s) => s.pushToast);
  const confirmRequest = useConfirmStore((s) => s.confirm);

  if (dismissed || valid.length === 0) return null;

  const runApply = (p: TaskBreakdownProposal) => {
    const fresh = useAppStore.getState();
    const opts = optionsRef.current;
    const result = applyTaskBreakdown(
      {
        assignmentId: p.assignmentId,
        subtaskTitles: p.subtasks.map((s) => s.title),
        mode: opts.mode,
        estimatedMinutes:
          opts.applyEstimate && p.suggestedEstimatedMinutes !== undefined
            ? p.suggestedEstimatedMinutes
            : undefined,
      },
      fresh
    );
    if (!result.ok) {
      setApplyingId(null);
      setStaleIds((s) => new Set(s).add(p.assignmentId));
      return;
    }
    undoRef.current.set(p.assignmentId, result.undo);
    setApplyingId(null);
    setAppliedIds((s) => new Set(s).add(p.assignmentId));
    pushToast({
      message: "已应用任务拆解",
      actionLabel: "撤销",
      onAction: () => handleUndo(p.assignmentId),
    });
  };

  const handleApply = (p: TaskBreakdownProposal) => {
    if (applyingId) return;
    const state = useAppStore.getState();
    const assignment = state.assignments.find((a) => a.id === p.assignmentId);
    if (!assignment) {
      setStaleIds((s) => new Set(s).add(p.assignmentId));
      return;
    }
    const existingCount = assignment.subtasks?.length ?? 0;
    optionsRef.current = { mode: "append", applyEstimate: true };
    setApplyingId(p.assignmentId);

    confirmRequest({
      title: "应用任务拆解",
      description: (
        <div className="space-y-2">
          <p>
            将 {p.subtasks.length} 个步骤应用到「{assignment.title}」
          </p>
          <BreakdownApplyOptions
            existingCount={existingCount}
            suggestedMinutes={p.suggestedEstimatedMinutes}
            existingMinutes={assignment.estimatedMinutes}
            onChange={(o) => {
              optionsRef.current = o;
            }}
          />
        </div>
      ),
      confirmLabel: "应用拆解",
      onConfirm: () => runApply(p),
      onCancel: () => setApplyingId(null),
    });
  };

  const handleUndo = (assignmentId: string) => {
    const undo = undoRef.current.get(assignmentId);
    if (!undo) return;
    undo();
    undoRef.current.delete(assignmentId);
    setAppliedIds((s) => {
      const next = new Set(s);
      next.delete(assignmentId);
      return next;
    });
    setRevokedIds((s) => new Set(s).add(assignmentId));
  };

  const renderActions = (p: TaskBreakdownProposal) => {
    const assignment = assignments.find((a) => a.id === p.assignmentId);
    const applied = appliedIds.has(p.assignmentId);
    const revoked = revokedIds.has(p.assignmentId);
    const stale = staleIds.has(p.assignmentId);
    const locked = !!assignment && (assignment.status === "submitted" || assignment.status === "completed");

    if (applied) {
      return (
        <span className="flex items-center gap-1 text-[10px] font-semibold text-[#627566]">
          <Check className="w-3 h-3" />
          已应用任务拆解
        </span>
      );
    }
    if (revoked) {
      return (
        <span className="text-[10px] font-semibold text-sandrift">已撤销，未修改任何数据。</span>
      );
    }
    if (stale) {
      return (
        <button
          onClick={() => setDismissed(true)}
          className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-bold text-white bg-charcoal hover:bg-black transition-colors"
        >
          <RefreshCcw className="w-3 h-3" />
          重新询问 Kiro
        </button>
      );
    }
    if (locked) {
      return (
        <span className="text-[10px] font-semibold text-sandrift" title="已提交/已完成的任务不能应用拆解">
          已完成任务，无法应用拆解
        </span>
      );
    }
    return (
      <>
        <button
          onClick={() => setDismissed(true)}
          className="px-3 h-8 rounded-lg text-[11px] font-bold text-charcoal bg-alabaster hover:bg-alba transition-colors"
        >
          调整
        </button>
        <button
          onClick={() => handleApply(p)}
          disabled={applyingId !== null}
          data-testid="task-breakdown-apply"
          className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-bold text-white bg-charcoal hover:bg-black transition-colors disabled:opacity-50"
        >
          {applyingId === p.assignmentId ? "应用中…" : "应用拆解"}
        </button>
      </>
    );
  };

  return (
    <div
      data-testid="task-breakdown-proposal"
      className="mt-2.5 bg-surface border border-line-strong rounded-2xl shadow-card p-3.5 space-y-3"
    >
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-charcoal">
          <ClipboardList className="w-3.5 h-3.5 text-[#A48F82]" />
          任务拆解建议
        </p>
        <button
          onClick={() => setDismissed(true)}
          aria-label="关闭"
          className="p-1 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="space-y-3">
        {valid.map((p) => {
          const assignment = assignments.find((a) => a.id === p.assignmentId);
          const hasExisting = p.suggestedEstimatedMinutes !== undefined && !!assignment?.estimatedMinutes;
          return (
            <div key={p.assignmentId} className="space-y-2">
              <div className="space-y-0.5">
                <p className="text-[11px] font-semibold text-charcoal leading-snug">
                  {assignment?.title ?? "未知任务"}
                </p>
                {p.suggestedEstimatedMinutes !== undefined && (
                  <p className="text-[10px] font-semibold text-satin-grey">
                    预计耗时：
                    {hasExisting
                      ? `${formatEstimatedMinutes(assignment!.estimatedMinutes)} → ${formatEstimatedMinutes(p.suggestedEstimatedMinutes)}`
                      : formatEstimatedMinutes(p.suggestedEstimatedMinutes)}
                    <span className="text-sandrift">（AI 估计）</span>
                  </p>
                )}
              </div>

              {p.subtasks.length > 0 && (
                <div className="space-y-1">
                  {p.subtasks.map((st, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="flex items-center gap-1.5 text-charcoal min-w-0">
                        <span className="w-3.5 h-3.5 shrink-0 rounded border border-[#CDB9AB]" />
                        <span className="truncate">{st.title}</span>
                      </span>
                      {st.estimatedMinutes !== undefined && (
                        <span className="text-sandrift shrink-0">建议 {formatEstimatedMinutes(st.estimatedMinutes)}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {p.rationale && p.rationale.length > 0 && (
                <ul className="space-y-0.5">
                  {p.rationale.map((r, i) => (
                    <li key={i} className="text-[10px] text-sandrift leading-snug">
                      · {r}
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex items-center justify-end gap-2 pt-1.5 border-t border-line-soft">
                {renderActions(p)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Apply 确认弹窗内的交互选项（自持 state，通过 onChange 同步到 Card ref，
 * 保证 ConfirmDialog 复用同一 ReactNode 时交互仍可靠）。
 */
function BreakdownApplyOptions({
  existingCount,
  suggestedMinutes,
  existingMinutes,
  onChange,
}: {
  existingCount: number;
  suggestedMinutes?: number;
  existingMinutes?: number;
  onChange: (o: { mode: ApplyBreakdownMode; applyEstimate: boolean }) => void;
}) {
  const [mode, setMode] = useState<ApplyBreakdownMode>("append");
  const [applyEstimate, setApplyEstimate] = useState(true);

  return (
    <div className="space-y-2.5">
      {existingCount > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold text-sandrift uppercase tracking-wider">
            已有 {existingCount} 个步骤
          </p>
          <label className="flex items-center gap-2 text-[11px] text-charcoal cursor-pointer">
            <input
              type="radio"
              name="breakdown-mode"
              checked={mode === "append"}
              onChange={() => {
                setMode("append");
                onChange({ mode: "append", applyEstimate });
              }}
              className="accent-charcoal"
            />
            追加到现有步骤
          </label>
          <label className="flex items-center gap-2 text-[11px] text-charcoal cursor-pointer">
            <input
              type="radio"
              name="breakdown-mode"
              checked={mode === "replace"}
              onChange={() => {
                setMode("replace");
                onChange({ mode: "replace", applyEstimate });
              }}
              className="accent-charcoal"
            />
            替换现有步骤
            <span className="text-sandrift">（已完成步骤将一并移除）</span>
          </label>
        </div>
      )}
      {suggestedMinutes !== undefined && (
        <label className={cn("flex items-center gap-2 text-[11px] cursor-pointer", existingCount > 0 && "pt-1.5 border-t border-line-soft")}>
          <input
            type="checkbox"
            checked={applyEstimate}
            onChange={() => {
              setApplyEstimate(!applyEstimate);
              onChange({ mode, applyEstimate: !applyEstimate });
            }}
            className="accent-charcoal"
          />
          同时将预计耗时设为 {formatEstimatedMinutes(suggestedMinutes)}
          {existingMinutes !== undefined && (
            <span className="text-sandrift">（当前 {formatEstimatedMinutes(existingMinutes)}）</span>
          )}
        </label>
      )}
    </div>
  );
}
