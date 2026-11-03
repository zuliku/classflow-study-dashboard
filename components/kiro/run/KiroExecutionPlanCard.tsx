"use client";

import React from "react";
import { CheckCircle2, Circle, ListChecks, AlertTriangle, Ban, CheckCheck } from "lucide-react";
import type { PersistedExecutionPlan } from "@/lib/ai/computer/plans/types";

function stepScopeText(s: PersistedExecutionPlan["steps"][number]): string {
  const parts = [s.toolName, s.path ?? s.pathPrefix, s.commandPrefix, s.artifactId, s.action].filter(
    Boolean
  ) as string[];
  return parts.join(" · ");
}

const STATUS_COPY: Record<PersistedExecutionPlan["status"], { label: string; className: string }> = {
  proposed: { label: "待批准", className: "text-warning" },
  approved: { label: "执行中", className: "text-charcoal" },
  completed: { label: "已完成", className: "text-success" },
  deviated: { label: "有超计划放行", className: "text-warning" },
  cancelled: { label: "已取消", className: "text-sandrift" },
  superseded: { label: "已被新计划取代", className: "text-sandrift" },
};

/**
 * plan-approve 模式 — 执行计划卡片（flat layout，与 Run Result 同权重）。
 * proposed → [批准执行][取消]；approved/deviated → 进度 + [取消计划]；
 * terminal（completed/cancelled/superseded）→ 纯展示。
 * 批准 = 单次授权整计划执行（切换执行模式由调用方完成）；不自动发送任何消息。
 */
export function KiroExecutionPlanCard({
  plan,
  onApprove,
  onCancel,
}: {
  plan: PersistedExecutionPlan;
  onApprove?: (planId: string) => void;
  onCancel?: (planId: string) => void;
}) {
  const doneCount = plan.steps.filter((s) => s.done).length;
  const status = STATUS_COPY[plan.status];
  const live = plan.status === "proposed" || plan.status === "approved" || plan.status === "deviated";
  return (
    <div data-testid="kiro-execution-plan" data-state={plan.status} className="space-y-1.5 pt-1 animate-enter">
      <p className="text-[11px] font-semibold text-satin-grey flex items-center gap-1.5">
        <ListChecks className="w-3 h-3" aria-hidden="true" />
        执行计划：{plan.title}
        <span className={`text-[10px] font-bold ${status.className}`}>{status.label}</span>
        {(plan.status === "approved" || plan.status === "deviated") && (
          <span className="text-[10px] text-sandrift tabular-nums">
            {doneCount}/{plan.steps.length}
          </span>
        )}
      </p>
      {plan.goal && <p className="text-[11px] text-satin-grey">{plan.goal}</p>}
      {plan.status === "deviated" && (
        <p className="text-[11px] font-semibold text-warning flex items-center gap-1.5 animate-enter">
          <AlertTriangle className="w-3 h-3" aria-hidden="true" />
          有 {plan.deviationCount} 次超计划操作已放行，其余步骤仍受约束
        </p>
      )}
      {plan.status === "completed" && (
        <p className="text-[11px] font-semibold text-success flex items-center gap-1.5 animate-enter">
          <CheckCheck className="w-3 h-3" aria-hidden="true" />
          计划步骤全部完成
        </p>
      )}
      <ol className="space-y-1">
        {plan.steps.map((s, i) => (
          <li key={s.id} className="flex items-start gap-1.5 text-[11px]">
            {s.done ? (
              <CheckCircle2 className="w-3 h-3 mt-0.5 text-success shrink-0" aria-hidden="true" />
            ) : (
              <Circle className="w-3 h-3 mt-0.5 text-sandrift shrink-0" aria-hidden="true" />
            )}
            <span className={`${s.done ? "text-sandrift line-through" : "text-charcoal"} transition-colors`}>
              {i + 1}. {s.title}
              {stepScopeText(s) && <span className="text-sandrift">（{stepScopeText(s)}）</span>}
            </span>
          </li>
        ))}
      </ol>
      {live && (
        <div className="flex items-center gap-2 pt-0.5">
          {plan.status === "proposed" && (
            <button
              data-testid="kiro-plan-approve"
              onClick={() => onApprove?.(plan.planId)}
              className="flex items-center gap-1 px-2.5 h-7 rounded-lg text-[11px] font-bold text-white bg-charcoal hover:bg-black transition-colors"
            >
              <CheckCheck className="w-3 h-3" aria-hidden="true" />
              批准执行
            </button>
          )}
          <button
            data-testid="kiro-plan-cancel"
            onClick={() => onCancel?.(plan.planId)}
            className="flex items-center gap-1 px-2.5 h-7 rounded-lg text-[11px] font-bold text-charcoal bg-alabaster hover:bg-alba transition-colors"
          >
            <Ban className="w-3 h-3" aria-hidden="true" />
            {plan.status === "proposed" ? "取消" : "取消计划"}
          </button>
        </div>
      )}
      {plan.status === "proposed" && (
        <p className="text-[10px] text-sandrift">批准后切换到工作区自动；下一条消息按计划执行，计划外操作需确认。</p>
      )}
    </div>
  );
}
