"use client";

import React from "react";
import { FocusRhythm } from "@/lib/analytics/types";
import { formatAnalyticsDuration } from "@/lib/analytics/presentation";
import { AnalyticsCardHeader } from "@/components/analytics/AnalyticsCardHeader";
import { cn } from "@/lib/utils";

/** 专注节奏：时段分布 + active days / avg session / longest（产品化 V2：无卡片壳、无装饰图标） */
export function FocusRhythmCard({ rhythm, nested = false }: { rhythm: FocusRhythm; nested?: boolean }) {
  const maxMinutes = Math.max(...rhythm.byTimeOfDay.map((b) => b.minutes), 1);
  return (
    <div
      className="w-full min-w-0 h-full flex flex-col"
      data-testid="focus-rhythm-card"
    >
      <AnalyticsCardHeader title="专注节奏" size={nested ? "sm" : "md"} />
      <div className="flex-1 flex flex-col justify-center gap-3 pt-4">
        {rhythm.byTimeOfDay.map((b) => {
          const active = rhythm.dominantTimeOfDay === b.bucket && b.minutes > 0;
          return (
            <div key={b.bucket} className="flex items-center gap-3">
              <span className="w-8 text-xs font-medium text-charcoal">{b.bucket}</span>
              <div className="flex-1 h-1 rounded-full bg-alabaster overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-[var(--motion-data)] ease-[var(--ease-standard)]",
                    active ? "bg-charcoal" : "bg-[#CDB9AB]"
                  )}
                  style={{ width: `${Math.max((b.minutes / maxMinutes) * 100, 2)}%` }}
                />
              </div>
              <span className="w-[78px] text-right text-[11px] text-sandrift shrink-0 tabular-nums">
                {formatAnalyticsDuration(b.minutes, "compact")}
                {b.sessions > 0 ? ` · ${b.sessions} 次` : ""}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 mt-4 border-t border-line-soft text-[11px] text-sandrift">
        <span>活跃 {rhythm.activeDays} 天</span>
        <span>平均 {rhythm.averageSessionMinutes !== null ? `${rhythm.averageSessionMinutes} 分钟/次` : "—"}</span>
        <span>最长 {formatAnalyticsDuration(rhythm.longestSessionMinutes)}</span>
      </div>
    </div>
  );
}

