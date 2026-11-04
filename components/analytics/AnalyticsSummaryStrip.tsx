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
 * - embedded：卡片内嵌档，去掉上下外边框并压缩数字/内边距
 */
export function AnalyticsSummaryStrip({
  metrics,
  className,
  embedded = false,
}: {
  metrics: { label: string; view: AnalyticsMetricView }[];
  className?: string;
  /** 卡片内嵌：去掉外层上下边框，由卡片提供边界 */
  embedded?: boolean;
}) {
  return (
    <div
      data-testid="analytics-summary-strip"
      className={cn(
        "grid grid-cols-2 xl:grid-cols-4",
        embedded ? "border-t border-line-soft" : "border-y border-line-soft",
        className
      )}
    >
      {metrics.map((m, i) => (
        <div key={m.label} className={summaryCellDividerClasses(i, embedded ? "px-3 py-3" : undefined)}>
          <p className={cn("font-medium text-sandrift", embedded ? "text-[11.5px]" : "text-xs")}>
            {m.label}
          </p>
          <p
            data-testid={`summary-value-${m.label}`}
            className={cn(
              // Hero 锚点：首项（实际专注）放大，其余保持同一字重层级。
              // 移动端收一档字号，避免「2 小时 55 分」在 2×2 格子里折行。
              "whitespace-nowrap font-semibold tracking-[-0.02em] tabular-nums",
              // value 槽位定高：28px Hero 与 22px 次级值共用同一行高，
              // 四列 label / value / detail 才能真正同基线。
              embedded ? "min-h-[21px] sm:min-h-[28px]" : "min-h-[28px] sm:min-h-[34px]",
              embedded
                ? i === 0
                  ? "text-[21px] text-charcoal sm:text-[28px]"
                  : "text-[17px] text-charcoal sm:text-[22px]"
                : i === 0
                  ? "text-[28px] text-charcoal sm:text-[34px]"
                  : "text-[22px] text-charcoal sm:text-[26px]",
              // 必须放在 text-[…] 之后：twMerge 会把任意字号前的 leading-* 视为冲突丢弃
              "leading-none"
            )}
          >
            {m.view.value}
          </p>
          {/* detail 槽位恒存在：四列 label / value / detail 严格同基线，
              无 detail 时占位但不可见（不缩高、不被读屏播报）。 */}
          <p
            data-testid={`summary-detail-${m.label}`}
            className={cn(
              "text-[11px] leading-snug text-satin-grey line-clamp-2",
              // 固定两行槽位：1 行 / 2 行 detail 的格子也保持同基线
              "min-h-[2.75em]",
              !m.view.detail && "invisible"
            )}
            aria-hidden={!m.view.detail || undefined}
          >
            {m.view.detail ?? "\u00A0"}
          </p>
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
      className="ux-skeleton grid grid-cols-2 xl:grid-cols-4 border-y border-line-soft"
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
