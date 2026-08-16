"use client";

import React from "react";
import { Info } from "lucide-react";
import { AnalyticsReliability } from "@/lib/analytics/types";

/**
 * Analytics V3 Coverage Notice（低关注，非 banner）：
 * 文案由真实 coverage 状态驱动，明确列出「哪些数据受影响」：
 * - assignment 不完整 → 任务相关指标只表达已记录
 * - plan 不完整 → 计划执行相关指标暂不显示
 * - focus backfill 存在（无法证明完整起点）→ 只说「已有专注记录仍计入」，不声称完整
 */
export function AnalyticsCoverageNotice({
  assignmentReliability,
  planReliability,
  focusReliability,
  focusBackfilled,
  historyStartedAt,
}: {
  assignmentReliability: AnalyticsReliability;
  planReliability: AnalyticsReliability;
  focusReliability: AnalyticsReliability;
  focusBackfilled: boolean;
  historyStartedAt: number;
}) {
  const fmt = (ts: number) => {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
  };

  const parts: string[] = [];
  if (assignmentReliability === "partial") {
    parts.push(`任务记录仅从 ${fmt(historyStartedAt)} 起完整，更早区间只显示已记录内容`);
  }
  if (planReliability === "partial") {
    parts.push(`学习计划在该区间记录不完整，计划执行相关指标暂不显示`);
  }
  if (focusReliability === "partial") {
    parts.push(`专注记录在该区间不完整`);
  } else if (focusBackfilled) {
    parts.push(`已有专注记录仍会正常计入统计`);
  }
  if (parts.length === 0) return null;

  return (
    <div
      data-testid="analytics-coverage-notice"
      className="flex items-start gap-2 px-3 py-2 bg-alabaster/60 border border-line rounded-xl text-[11px] text-sandrift"
    >
      <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <p>部分历史记录不完整 · {parts.join("；")}</p>
    </div>
  );
}
