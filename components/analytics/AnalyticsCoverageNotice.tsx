"use client";

import React from "react";
import { Info } from "lucide-react";

/** Coverage 提示（低干扰；仅在当前范围不完整时出现） */
export function AnalyticsCoverageNotice({
  fullCoverage,
  historyStartedAt,
}: {
  fullCoverage: boolean;
  historyStartedAt: number;
}) {
  if (fullCoverage) return null;
  const d = new Date(historyStartedAt);
  const p = (n: number) => String(n).padStart(2, "0");
  const label = `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
  return (
    <div className="flex items-start gap-2 px-3 py-2 bg-alabaster/60 border border-line rounded-xl text-[11px] text-sandrift">
      <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <p>
        历史数据自 {label} 起完整记录，当前所选区间的部分指标可能不完整。
      </p>
    </div>
  );
}
