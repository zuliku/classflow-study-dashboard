"use client";

import React from "react";
import { CourseInvestment } from "@/lib/analytics/types";
import { cn } from "@/lib/utils";

const BAR_COLORS = ["#627566", "#CDB9AB", "#A48F82", "#9B5B57", "#A87952"];

/** 课程投入（Top 5 + 其他；横向 bar；无 Pie） */
export function CourseInvestmentCard({ investment }: { investment: CourseInvestment[] }) {
  if (investment.length === 0) {
    return (
      <div className="bg-surface border border-line rounded-2xl p-4 shadow-subtle">
        <h3 className="text-sm font-bold text-charcoal pb-2 border-b border-[#F0EBE1]">课程投入</h3>
        <div className="py-6 text-center">
          <p className="text-[11px] text-sandrift">完成专注后这里会展示各课程投入</p>
        </div>
      </div>
    );
  }
  const maxMinutes = Math.max(...investment.map((i) => i.minutes), 1);
  return (
    <div className="bg-surface border border-line rounded-2xl p-4 shadow-subtle">
      <h3 className="text-sm font-bold text-charcoal pb-2 border-b border-[#F0EBE1]">课程投入</h3>
      <div className="space-y-2 pt-2">
        {investment.map((item, index) => (
          <div key={item.courseId ?? "unlinked"} className="space-y-0.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-charcoal truncate">{item.courseName}</span>
              <span className="text-[10px] text-sandrift shrink-0">
                {formatMin(item.minutes)} · {Math.round(item.share * 100)}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-alabaster overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max((item.minutes / maxMinutes) * 100, 2)}%`,
                  backgroundColor: BAR_COLORS[index % BAR_COLORS.length],
                }}
              />
            </div>
          </div>
        ))}
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
