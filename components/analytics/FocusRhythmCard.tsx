"use client";

import React from "react";
import { Moon, Sunrise, Sun, MoonStar, CalendarDays } from "lucide-react";
import { FocusRhythm } from "@/lib/analytics/types";
import { formatAnalyticsDuration } from "@/lib/analytics/presentation";
import { cn } from "@/lib/utils";

const BUCKET_ICON: Record<string, typeof Moon> = {
  深夜: Moon,
  上午: Sunrise,
  下午: Sun,
  晚间: MoonStar,
};

/** 专注节奏：时段分布 + active days / avg session / longest（V3 中文 duration，Level 2 surface） */
export function FocusRhythmCard({ rhythm }: { rhythm: FocusRhythm }) {
  const maxMinutes = Math.max(...rhythm.byTimeOfDay.map((b) => b.minutes), 1);
  return (
    <div
      className="w-full min-w-0 bg-surface border border-line rounded-2xl p-4 h-fit"
      data-testid="focus-rhythm-card"
    >
      <h3 className="text-sm font-bold text-charcoal">专注节奏</h3>
      <div className="space-y-1.5 pt-3">
        {rhythm.byTimeOfDay.map((b) => {
          const Icon = BUCKET_ICON[b.bucket] ?? Moon;
          const active = rhythm.dominantTimeOfDay === b.bucket && b.minutes > 0;
          return (
            <div key={b.bucket} className="flex items-center gap-2">
              <Icon className={cn("w-3.5 h-3.5 text-sandrift shrink-0", active && "text-success")} />
              <span className="w-8 text-[11px] font-semibold text-charcoal">{b.bucket}</span>
              <div className="flex-1 h-1.5 rounded-full bg-alabaster overflow-hidden">
                <div
                  className={cn("h-full rounded-full", active ? "bg-success/70" : "bg-[#CDB9AB]")}
                  style={{ width: `${Math.max((b.minutes / maxMinutes) * 100, 2)}%` }}
                />
              </div>
              <span className="w-[74px] text-right text-[10px] text-sandrift shrink-0">
                {formatAnalyticsDuration(b.minutes, "compact")}
                {b.sessions > 0 ? ` · ${b.sessions} 次` : ""}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 mt-3 border-t border-line-soft text-[10px] text-sandrift">
        <span className="flex items-center gap-1">
          <CalendarDays className="w-3 h-3" />
          活跃 {rhythm.activeDays} 天
        </span>
        <span>平均 {rhythm.averageSessionMinutes !== null ? `${rhythm.averageSessionMinutes} 分钟/次` : "—"}</span>
        <span>最长 {formatAnalyticsDuration(rhythm.longestSessionMinutes)}</span>
      </div>
    </div>
  );
}
