"use client";

import React from "react";
import { Info } from "lucide-react";

/** Coverage 提示（低干扰；整体 History 不完整 或 计划序列不完整时出现） */
export function AnalyticsCoverageNotice({
  fullCoverage,
  historyStartedAt,
  planCoverageFull,
  planCoverageStartedAt,
}: {
  fullCoverage: boolean;
  historyStartedAt: number;
  planCoverageFull: boolean;
  planCoverageStartedAt: number;
}) {
  const fmt = (ts: number) => {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
  };
  // 整体不完整 → 原提示；整体完整但计划序列不完整 → 计划专项提示（不说"数据错误"）
  const note = !fullCoverage
    ? `历史数据自 ${fmt(historyStartedAt)} 起完整记录，当前所选区间的部分指标可能不完整。`
    : !planCoverageFull
      ? `学习计划的完整历史自 ${fmt(planCoverageStartedAt)} 起记录；此前 Kiro 批量生成的学习计划可能未被完整记录。`
      : null;
  if (!note) return null;
  return (
    <div className="flex items-start gap-2 px-3 py-2 bg-alabaster/60 border border-line rounded-xl text-[11px] text-sandrift">
      <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <p>{note}</p>
    </div>
  );
}
