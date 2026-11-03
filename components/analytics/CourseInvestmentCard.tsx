"use client";

import React from "react";
import { CourseInvestmentView } from "@/lib/analytics/presentation";
import { formatAnalyticsDuration } from "@/lib/analytics/presentation";
import { AnalyticsCardHeader } from "@/components/analytics/AnalyticsCardHeader";
import { cn } from "@/lib/utils";

const BAR_COLORS = ["#627566", "#CDB9AB", "#A48F82", "#9B5B57", "#A87952"];
const NEUTRAL_COLOR = "#C7BCB2";

/**
 * 课程投入（V3）：显示名已由 presentCourseInvestment 解析
 * （snapshot → current name → 已删除课程 → 未关联课程；Top5 + 其他）。
 * Level 2 surface；「其他」/「未关联课程」用 neutral tone。
 * onOpenCourse（可选）：存在课程 id 的非聚合行可点击打开 Floating Course Hub。
 */
export function CourseInvestmentCard({
  investment,
  onOpenCourse,
}: {
  investment: CourseInvestmentView[];
  onOpenCourse?: (courseId: string) => void;
}) {
  if (investment.length === 0) {
    return (
      <div className="w-full min-w-0 h-full flex flex-col ux-fade" data-testid="course-investment-card">
        <AnalyticsCardHeader title="课程投入" />
        <div className="flex flex-1 items-center justify-center py-8">
          <p className="text-[11px] text-sandrift">完成专注后显示课程投入</p>
        </div>
      </div>
    );
  }
  const maxMinutes = Math.max(...investment.map((i) => i.minutes), 1);
  return (
    <div className="w-full min-w-0 h-full flex flex-col ux-fade" data-testid="course-investment-card">
      <AnalyticsCardHeader title="课程投入" />
      <div className="flex flex-col gap-3 pt-4">
        {investment.map((item, index) => {
          const neutral = item.isOther || item.courseName === "未关联课程";
          const clickable = onOpenCourse && item.courseId !== null && !item.isOther;
          return (
            <div key={item.courseId ?? `other-${index}`} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <button
                  type="button"
                  disabled={!clickable}
                  onClick={() => {
                    if (clickable) onOpenCourse(item.courseId as string);
                  }}
                  className={cn(
                    "text-xs font-medium truncate text-left",
                    clickable
                      ? "text-charcoal hover:text-black underline-offset-2 hover:underline cursor-pointer"
                      : cn("cursor-default", neutral ? "text-sandrift" : "text-charcoal")
                  )}
                >
                  {item.courseName}
                </button>
                <span className="text-[11px] text-sandrift shrink-0 tabular-nums">
                  {formatAnalyticsDuration(item.minutes)} · {Math.round(item.share * 100)}%
                </span>
              </div>
              <div className="h-1 rounded-full bg-alabaster overflow-hidden">
                <div
                  className="h-full rounded-full transition-[width] duration-[var(--motion-data)] ease-[var(--ease-standard)]"
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
