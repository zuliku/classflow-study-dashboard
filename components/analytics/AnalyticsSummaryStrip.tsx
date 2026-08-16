"use client";

import React from "react";
import { AnalyticsMetricView } from "@/lib/analytics/presentation";
import { cn } from "@/lib/utils";

/**
 * Analytics V3 Summary Strip：一个共同 surface 承载四项 KPI
 * （实际专注 / 完成任务 / 计划执行 / 按时完成），替代四张独立大卡。
 * - Desktop：4 列（vertical divider）；<lg：2×2
 * - value 22–24px；label 11px；detail 10px（partial 语义由 present* 生成）
 */
export function AnalyticsSummaryStrip({
  metrics,
  className,
}: {
  metrics: { label: string; view: AnalyticsMetricView }[];
  className?: string;
}) {
  return (
    <div
      data-testid="analytics-summary-strip"
      className={cn(
        "grid grid-cols-2 lg:grid-cols-4",
        "bg-surface border border-line rounded-2xl shadow-subtle",
        className
      )}
    >
      {metrics.map((m, i) => (
        <div
          key={m.label}
          className={cn(
            "min-w-0 px-4 py-3.5 flex flex-col justify-center gap-0.5",
            // 2×2（mobile/tablet）：第 2、4 列左侧分隔；第 3、4 行顶部分隔
            (i === 1 || i === 3) && "border-l border-line-soft",
            i >= 2 && "border-t border-line-soft",
            // 4 列（desktop）：除首列外全左侧分隔，去掉顶部
            i > 0 && "lg:border-l lg:border-line-soft",
            i >= 2 && "lg:border-t-0"
          )}
        >
          <p className="text-[11px] font-semibold text-sandrift">{m.label}</p>
          <p
            data-testid={`summary-value-${m.label}`}
            className="text-[22px] font-extrabold leading-tight text-charcoal tabular-nums"
          >
            {m.view.value}
          </p>
          <p className="truncate text-[10px] text-satin-grey">{m.view.detail ?? ""}</p>
        </div>
      ))}
    </div>
  );
}

/** Loading：布局与最终 strip 一致（减少 layout shift）；值均为 — */
export function AnalyticsSummaryStripSkeleton() {
  return (
    <div
      data-testid="analytics-summary-strip"
      className="grid grid-cols-2 lg:grid-cols-4 bg-surface border border-line rounded-2xl shadow-subtle"
      aria-label="学习指标加载中"
    >
      {["实际专注", "完成任务", "计划执行", "按时完成"].map((label, i) => (
        <div
          key={label}
          className={cn(
            "min-w-0 px-4 py-3.5 flex flex-col justify-center gap-2",
            i > 0 && "border-l border-line-soft",
            i > 1 && "border-t border-line-soft lg:border-t-0"
          )}
        >
          <div className="h-3 w-12 rounded bg-alabaster animate-pulse" />
          <div className="h-6 w-20 rounded bg-alabaster animate-pulse" />
          <div className="h-2.5 w-24 rounded bg-alabaster animate-pulse" />
        </div>
      ))}
    </div>
  );
}
