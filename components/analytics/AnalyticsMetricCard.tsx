"use client";

import React from "react";
import { cn } from "@/lib/utils";

/** 学习洞察指标卡（数字为主角；delta 克制；整卡不因涨跌变色） */
export function AnalyticsMetricCard({
  label,
  value,
  sub,
  delta,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: { percent: number } | null;
}) {
  return (
    <div className="p-4 bg-surface border border-line rounded-2xl shadow-subtle space-y-1 min-w-0">
      <span className="text-xs font-semibold text-sandrift">{label}</span>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-extrabold text-charcoal">{value}</span>
        {delta !== undefined && delta !== null && (
          <span
            className={cn(
              "text-[10px] font-bold shrink-0",
              delta.percent >= 0 ? "text-success" : "text-sandrift"
            )}
          >
            {delta.percent >= 0 ? "↑" : "↓"} {Math.abs(delta.percent)}%
          </span>
        )}
      </div>
      {sub && <p className="text-[10px] text-sandrift">{sub}</p>}
    </div>
  );
}
