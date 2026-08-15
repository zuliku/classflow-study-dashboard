"use client";

import React from "react";
import { Moon, Sunrise, Sun, MoonStar, CalendarDays } from "lucide-react";
import { FocusRhythm } from "@/lib/analytics/types";
import { cn } from "@/lib/utils";

const BUCKET_ICON: Record<string, typeof Moon> = {
  深夜: Moon,
  上午: Sunrise,
  下午: Sun,
  晚间: MoonStar,
};

/** 专注节奏：时段分布 + active days / avg session / longest */
export function FocusRhythmCard({ rhythm }: { rhythm: FocusRhythm }) {
  const maxMinutes = Math.max(...rhythm.byTimeOfDay.map((b) => b.minutes), 1);
  return (
    <div className="bg-surface border border-line rounded-2xl p-4 shadow-subtle">
      <h3 className="text-sm font-bold text-charcoal pb-2 border-b border-[#F0EBE1]">专注节奏</h3>
      <div className="space-y-1.5 pt-2">
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
              <span className="w-14 text-right text-[10px] text-sandrift shrink-0">
                {formatMin(b.minutes)}{b.sessions > 0 ? ` · ${b.sessions} 次` : ""}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3 pt-2 mt-2 border-t border-[#F0EBE1] text-[10px] text-sandrift">
        <span className="flex items-center gap-1">
          <CalendarDays className="w-3 h-3" />
          活跃 {rhythm.activeDays} 天
        </span>
        <span>平均 {rhythm.averageSessionMinutes ?? 0} 分钟/次</span>
        <span>最长 {formatMin(rhythm.longestSessionMinutes)}</span>
      </div>
    </div>
  );
}

function formatMin(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h${m > 0 ? ` ${m}m` : ""}`;
}
