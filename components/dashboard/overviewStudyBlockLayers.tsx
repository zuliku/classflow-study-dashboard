"use client";

import React from "react";
import { format } from "date-fns";
import { StudyBlock, Semester } from "@/types";
import { getWeekDateRange } from "@/lib/semester";

/**
 * 总览页课表时间线上的 StudyBlock 任务小卡片图层。
 *
 * 与时间表（TimelineWorkspace）同一视觉语言（浅 mint 底 + 明显虚线边框）：
 * 把学习计划/任务小卡片融合进总览 TimetableGrid 每一天列的时间线中，
 * 而不是单独模块。仅展示（pointer-events-none），拖动/编辑仍在时间表进行。
 * 与课程重叠的块会被上层课程卡（z 更高）自然遮住，不重复占用视觉。
 */
export function buildOverviewStudyBlockLayers(input: {
  studyBlocks: StudyBlock[];
  semester: Semester;
  currentSemesterWeek: number;
}) {
  const { studyBlocks, semester, currentSemesterWeek } = input;
  const weekDates = getWeekDateRange(semester, currentSemesterWeek);
  const dateByDay = new Map<number, string>();
  weekDates.forEach((d, i) => dateByDay.set(i + 1, format(d, "yyyy-MM-dd")));

  return (ctx: {
    dayOfWeek: number;
    dayStartMinutes: number;
    totalMinutes: number;
    timeToMinutes: (t: string) => number;
  }): React.ReactNode => {
    const date = dateByDay.get(ctx.dayOfWeek);
    if (!date) return null;
    const dayBlocks = studyBlocks
      .filter((b) => b.date === date)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    if (dayBlocks.length === 0) return null;
    return (
      <>
        {dayBlocks.map((b) => {
          const rawS = ctx.timeToMinutes(b.startTime);
          const rawE = ctx.timeToMinutes(b.endTime);
          if (rawS === null || rawE === null) return null;
          const s = Math.max(rawS, ctx.dayStartMinutes);
          const e = Math.min(rawE, ctx.dayStartMinutes + ctx.totalMinutes);
          if (e <= s) return null;
          const topPct = ((s - ctx.dayStartMinutes) / ctx.totalMinutes) * 100;
          const heightPct = ((e - s) / ctx.totalMinutes) * 100;
          return (
            <div
              key={b.id}
              data-testid="overview-timetable-study-block"
              title={`${b.title} · ${b.startTime}–${b.endTime}`}
              className="absolute left-1 right-1 z-[2] rounded-lg border border-dashed border-line bg-pastel-mint/20 px-1.5 py-0.5 flex items-center gap-1 overflow-hidden pointer-events-none"
              style={{ top: `${topPct}%`, height: `${Math.max(heightPct, 2)}%`, minHeight: 4 }}
            >
              <span className="truncate text-[10px] font-semibold text-satin-grey">{b.title}</span>
              <span className="shrink-0 text-[9px] text-sandrift">{b.startTime}</span>
            </div>
          );
        })}
      </>
    );
  };
}
