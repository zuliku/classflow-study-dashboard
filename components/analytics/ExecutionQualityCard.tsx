"use client";

import React from "react";
import { ClipboardCheck } from "lucide-react";
import { ExecutionAnalytics } from "@/lib/analytics/types";

/** 执行情况：完成任务 / 重开 / 按时率 / 活跃天数 */
export function ExecutionQualityCard({ execution }: { execution: ExecutionAnalytics }) {
  const onTimeText =
    execution.onTimeEligible === 0
      ? "暂无可靠截止时间可判断"
      : execution.onTimeEligible < 3
        ? `样本不足 · 目前有 ${execution.onTimeEligible} 个可判断任务`
        : `${execution.onTime} / ${execution.onTimeEligible} 个可判断任务按时完成`;
  return (
    <div className="bg-surface border border-line rounded-2xl p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-bold text-charcoal pb-2 border-b border-[#F0EBE1]">
        <ClipboardCheck className="w-4 h-4 text-[#A48F82]" />
        执行情况
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3">
        <div>
          <p className="text-[10px] font-semibold text-sandrift">完成任务</p>
          <p className="text-xl font-extrabold text-charcoal">{execution.uniqueCompletedAssignments}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-sandrift">重新开启</p>
          <p className="text-xl font-extrabold text-charcoal">{execution.reopenedAssignments}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-sandrift">按时完成</p>
          <p className="text-xl font-extrabold text-charcoal">
            {execution.onTimeRate !== null ? `${execution.onTimeRate}%` : "—"}
          </p>
          <p className="text-[9px] text-sandrift mt-0.5">{onTimeText}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-sandrift">专注活跃天数</p>
          <p className="text-xl font-extrabold text-charcoal">{execution.activeDays}</p>
        </div>
      </div>
    </div>
  );
}
