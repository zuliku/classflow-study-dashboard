"use client";

import React from "react";
import { AnalyticsMetricView, summaryCellDividerClasses } from "@/lib/analytics/presentation";
import { cn } from "@/lib/utils";

/**
 * Analytics V3 Summary Strip：扁平四列 KPI（实际专注 / 完成任务 / 计划执行 / 按时完成）。
 * 产品化 V2：不再使用卡片壳与阴影，以上下细线 + 列分隔线组织层级。
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
        "border-y border-line-soft",
        className
      )}
    >
      {metrics.map((m, i) => (
        <div key={m.label} className={summaryCellDividerClasses(i)}>
          <p className="text-xs font-medium text-sandrift">{m.label}</p>
          <p
            data-testid={`summary-value-${m.label}`}
            className={cn(
              // Hero 锚点：首项（实际专注）放大，其余保持同一字重层级
              "font-semibold leading-none tracking-[-0.02em] tabular-nums",
              i === 0 ? "text-[34px] text-charcoal" : "text-[26px] text-charcoal"
            )}
          >
            {m.view.value}
          </p>
          {m.view.detail && (
            <p
              data-testid={`summary-detail-${m.label}`}
              className="text-[11px] leading-snug text-satin-grey line-clamp-2 min-h-[2.5em]"
            >
              {m.view.detail}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/** Loading：布局与最终 strip 完全一致（同一 divider helper；值均为 —）。 */
export function AnalyticsSummaryStripSkeleton() {
  return (
    <div
      data-testid="analytics-summary-strip"
      className="ux-skeleton grid grid-cols-2 lg:grid-cols-4 border-y border-line-soft"
      aria-label="学习指标加载中"
    >
      {["实际专注", "完成任务", "计划执行", "按时完成"].map((label, i) => (
        <div key={label} className={summaryCellDividerClasses(i)}>
          <div className="h-3 w-12 rounded bg-alabaster animate-pulse" />
          <div className={cn("rounded bg-alabaster animate-pulse", i === 0 ? "h-[34px] w-24" : "h-[26px] w-20")} />
          <div className="h-2.5 w-24 rounded bg-alabaster animate-pulse" />
        </div>
      ))}
    </div>
  );
}
