"use client";

import React from "react";
import { CourseInvestmentView } from "@/lib/analytics/presentation";
import { formatAnalyticsDuration } from "@/lib/analytics/presentation";
import { cn } from "@/lib/utils";

const BAR_COLORS = ["#627566", "#CDB9AB", "#A48F82", "#9B5B57", "#A87952"];
const NEUTRAL_COLOR = "#C7BCB2";

/**
 * 课程投入（V3）：显示名已由 presentCourseInvestment 解析
 * （snapshot → current name → 已删除课程 → 未关联课程；Top5 + 其他）。
 * Level 2 surface；「其他」/「未关联课程」用 neutral tone。
 */
export function CourseInvestmentCard({ investment }: { investment: CourseInvestmentView[] }) {
  if (investment.length === 0) {
    return (
      <div className="bg-surface border border-line rounded-2xl p-4 h-fit">
        <h3 className="text-sm font-bold text-charcoal">课程投入</h3>
        <div className="pt-3 pb-2 text-center">
          <p className="text-[11px] text-sandrift">完成专注后这里会展示各课程投入</p>
        </div>
      </div>
    );
  }
  const maxMinutes = Math.max(...investment.map((i) => i.minutes), 1);
  return (
    <div className="bg-surface border border-line rounded-2xl p-4 h-fit" data-testid="course-investment-card">
      <h3 className="text-sm font-bold text-charcoal">课程投入</h3>
      <div className="space-y-2.5 pt-3">
        {investment.map((item, index) => {
          const neutral = item.isOther || item.courseName === "未关联课程";
          return (
            <div key={item.courseId ?? `other-${index}`} className="space-y-0.5">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    "text-[11px] font-semibold truncate",
                    neutral ? "text-sandrift" : "text-charcoal"
                  )}
                  title={item.courseName}
                >
                  {item.courseName}
                </span>
                <span className="text-[10px] text-sandrift shrink-0">
                  {formatAnalyticsDuration(item.minutes)} · {Math.round(item.share * 100)}%
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-alabaster overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max((item.minutes / maxMinutes) * 100, 2)}%`,
                    backgroundColor: neutral ? NEUTRAL_COLOR : BAR_COLORS[index % BAR_COLORS.length],
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
