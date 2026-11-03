"use client";

import React from "react";
import { ExecutionQualityView } from "@/lib/analytics/presentation";
import { AnalyticsCardHeader } from "@/components/analytics/AnalyticsCardHeader";

/**
 * 执行情况（V3.1）：3 个 primary 列 + secondary footer。
 * 产品化 V2：无卡片壳 / 无装饰图标，数字与说明直接落在页面上。
 */
export function ExecutionQualityCard({ view }: { view: ExecutionQualityView }) {
  return (
    <div data-testid="execution-quality-card">
      <AnalyticsCardHeader title="执行情况" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-4 pt-4">
        {[view.completed, view.reopened, view.onTime].map((m) => (
          <div key={m.label} data-testid={`execution-${m.label}`}>
            <p className="text-[11px] font-medium text-sandrift">{m.label}</p>
            <p className="text-[24px] font-semibold leading-tight tracking-[-0.02em] text-charcoal tabular-nums">{m.value}</p>
            {m.detail && (
              <p className="text-[11px] text-satin-grey mt-1 leading-snug line-clamp-2">{m.detail}</p>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-4 mt-4 border-t border-line-soft text-[11px] text-sandrift">
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
