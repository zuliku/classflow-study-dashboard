"use client";

import React from "react";
import { ClipboardCheck } from "lucide-react";
import { ExecutionQualityView } from "@/lib/analytics/presentation";

/**
 * 执行情况（V3.1）：3 个 primary 列（完成任务 / 重新打开 / 按时完成）+ secondary footer
 * （活跃天数 · 平均专注）。全部值来自 presentExecutionQuality（reliability-aware：
 * partial 只显示「已记录」，按时率在任务历史不完整时恒为 —）。
 */
export function ExecutionQualityCard({ view }: { view: ExecutionQualityView }) {
  return (
    <div className="bg-surface border border-line rounded-2xl p-4" data-testid="execution-quality-card">
      <h3 className="flex items-center gap-1.5 text-sm font-bold text-charcoal">
        <ClipboardCheck className="w-4 h-4 text-[#A48F82]" />
        执行情况
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3">
        {[view.completed, view.reopened, view.onTime].map((m) => (
          <div key={m.label} data-testid={`execution-${m.label}`}>
            <p className="text-[10px] font-semibold text-sandrift">{m.label}</p>
            <p className="text-xl font-extrabold text-charcoal leading-tight">{m.value}</p>
            {m.detail && (
              <p className="text-[9px] text-satin-grey mt-0.5 leading-snug line-clamp-2">{m.detail}</p>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-3 mt-3 border-t border-line-soft text-[10px] text-sandrift">
        <span>
          {view.activeDays.label} {view.activeDays.value}
        </span>
        <span>
          {view.avgFocusSession.label} {view.avgFocusSession.value}
        </span>
        {view.activeDays.detail && <span className="text-satin-grey/80">{view.activeDays.detail}</span>}
        {view.avgFocusSession.detail && <span className="text-satin-grey/80">{view.avgFocusSession.detail}</span>}
      </div>
    </div>
  );
}
