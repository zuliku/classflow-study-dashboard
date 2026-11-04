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
      <div data-testid="execution-quality-card">
        <p className="text-[10.5px] font-medium text-sandrift">执行情况</p>
        <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.35fr)] gap-3">
          {[view.completed, view.reopened, view.onTime].map((m) => (
            <div key={m.label} data-testid={`execution-${m.label}`} className="min-w-0">
              <p className="text-[10px] text-sandrift">{m.label}</p>
              <p className="mt-0.5 whitespace-nowrap text-[12px] font-semibold tabular-nums text-charcoal">
                {m.value}
              </p>
              {m.detail && (
                <p className="mt-0.5 text-[9.5px] leading-snug text-sandrift line-clamp-2">{m.detail}</p>
              )}
            </div>
          ))}
        </div>
        <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-t border-line-soft pt-1.5 text-[10px] text-sandrift">
          <span>
            {view.activeDays.label} {view.activeDays.value}
          </span>
          <span>
            {view.avgFocusSession.label} {view.avgFocusSession.value}
          </span>
        </p>
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
        {(view.activeDays.detail ?? view.avgFocusSession.detail) && (
          <span className="text-satin-grey/80">
            {view.activeDays.detail ?? view.avgFocusSession.detail}
          </span>
        )}
      </div>
    </div>
  );
}


