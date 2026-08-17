"use client";

import React from "react";
import { AnalyticsMetricView, summaryCellDividerClasses } from "@/lib/analytics/presentation";
import { cn } from "@/lib/utils";

/**
 * Analytics V3 Summary Strip：一个共同 surface 承载四项 KPI
 * （实际专注 / 完成任务 / 计划执行 / 按时完成），替代四张独立大卡。
 * - Desktop：4 列（vertical divider）；<lg：2×2
 * - detail 永不 truncate（可信度信息必须可读）：line-clamp-2 + title 完整文本
 * - divider 规则与 Skeleton 共用 summaryCellDividerClasses（无加载几何位移）
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
        <div key={m.label} className={summaryCellDividerClasses(i)}>
          <p className="text-[11px] font-semibold text-sandrift">{m.label}</p>
          <p
            data-testid={`summary-value-${m.label}`}
            className="text-[22px] font-extrabold leading-tight text-charcoal tabular-nums"
          >
            {m.view.value}
          </p>
          {m.view.detail && (
            <p
              data-testid={`summary-detail-${m.label}`}
              title={m.view.detail}
              className="text-[10px] leading-snug text-satin-grey line-clamp-2 min-h-[2.5em]"
            >
              {m.view.detail}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/** Loading：布局与最终 strip 完全一致（同一 divider helper；值均为 —） */
export function AnalyticsSummaryStripSkeleton() {
  return (
    <div
      data-testid="analytics-summary-strip"
      className="grid grid-cols-2 lg:grid-cols-4 bg-surface border border-line rounded-2xl shadow-subtle"
      aria-label="学习指标加载中"
    >
      {["实际专注", "完成任务", "计划执行", "按时完成"].map((label, i) => (
        <div key={label} className={summaryCellDividerClasses(i)}>
          <div className="h-3 w-12 rounded bg-alabaster animate-pulse" />
          <div className="h-6 w-20 rounded bg-alabaster animate-pulse" />
          <div className="h-2.5 w-24 rounded bg-alabaster animate-pulse" />
        </div>
      ))}
    </div>
  );
}
