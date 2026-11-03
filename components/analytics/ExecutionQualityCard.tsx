"use client";

import React from "react";
import { ExecutionQualityView } from "@/lib/analytics/presentation";
import { AnalyticsCardHeader } from "@/components/analytics/AnalyticsCardHeader";
import { cn } from "@/lib/utils";

/**
 * 执行情况（V3.1）：3 个 primary 列 + secondary footer。
 * 产品化 V2：无卡片壳 / 无装饰图标，数字与说明直接落在页面上。
 * compact：总览右栏使用，压缩数字与间距，保留 reliability detail。
 */
export function ExecutionQualityCard({
  view,
  compact = false,
  inline = false,
}: {
  view: ExecutionQualityView;
  compact?: boolean;
  /** 摘要卡内一行式执行摘要（保留全部 reliability detail 与 testid） */
  inline?: boolean;
}) {
  if (inline) {
    return (
      <div
        data-testid="execution-quality-card"
        className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-satin-grey"
      >
        <span className="text-[11px] font-medium text-sandrift">执行情况</span>
        {[view.completed, view.reopened, view.onTime].map((m) => (
          <span key={m.label} data-testid={`execution-${m.label}`} className="min-w-0">
            <span className="text-sandrift">{m.label}</span>{" "}
            <span className="font-semibold text-charcoal">{m.value}</span>
            {m.detail && <span className="text-satin-grey"> · {m.detail}</span>}
          </span>
        ))}
        <span className="ml-auto whitespace-nowrap text-[10.5px] text-sandrift">
          {view.activeDays.label} {view.activeDays.value} · {view.avgFocusSession.label} {view.avgFocusSession.value}
        </span>
      </div>
    );
  }

  return (
    <div data-testid="execution-quality-card">
      <AnalyticsCardHeader title="执行情况" />
      <div
        className={cn(
          "grid gap-x-5 gap-y-3 pt-3",
          compact ? "grid-cols-3" : "grid-cols-1 pt-4 sm:grid-cols-3 sm:gap-x-6 sm:gap-y-4"
        )}
      >
        {[view.completed, view.reopened, view.onTime].map((m) => (
          <div key={m.label} data-testid={`execution-${m.label}`}>
            <p className="text-[10px] font-medium text-sandrift">{m.label}</p>
            <p
              className={cn(
                "font-semibold leading-tight tracking-[-0.02em] text-charcoal tabular-nums",
                compact ? "text-[18px]" : "text-[24px]"
              )}
            >
              {m.value}
            </p>
            {m.detail && (
              <p
                className={cn(
                  "text-satin-grey mt-0.5 leading-snug",
                  compact ? "text-[10px] line-clamp-2" : "text-[11px] mt-1 line-clamp-2"
                )}
              >
                {m.detail}
              </p>
            )}
          </div>
        ))}
      </div>
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-soft text-sandrift",
          compact ? "pt-2.5 mt-3 text-[10px]" : "pt-4 mt-4 text-[11px]"
        )}
      >
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


