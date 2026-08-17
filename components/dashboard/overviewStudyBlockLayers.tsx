"use client";

import React from "react";
import { format } from "date-fns";
import { StudyBlock, Semester, CourseSchedule } from "@/types";
import { getWeekDateRange } from "@/lib/semester";
import { isScheduleActive } from "@/lib/schedule";

/** StudyBlock 与某课程是否同时间重叠（视觉层判断；课程生效周由调用方过滤） */
function timeOverlap(
  block: { startTime: string; endTime: string },
  schedule: { startTime: string; endTime: string }
): boolean {
  const toMin = (t: string): number | null => {
    const [h, m] = t.split(":").map(Number);
    if (typeof h !== "number" || typeof m !== "number" || Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
  };
  const s = toMin(block.startTime);
  const e = toMin(block.endTime);
  const ss = toMin(schedule.startTime);
  const se = toMin(schedule.endTime);
  if (s === null || e === null || ss === null || se === null) return false;
  return s < se && ss < e;
}

function weekDateByDay(semester: Semester, week: number): Map<number, string> {
  const dateByDay = new Map<number, string>();
  getWeekDateRange(semester, week).forEach((d, i) => dateByDay.set(i + 1, format(d, "yyyy-MM-dd")));
  return dateByDay;
}

/**
 * 总览页课表时间线上的 StudyBlock 任务小卡片图层。
 *
 * 与时间表（TimelineWorkspace）同一视觉语言（浅 mint 底 + 明显虚线边框）：
 * 把学习计划/任务小卡片融合进总览 TimetableGrid 每一天列的时间线中，
 * 而不是单独模块。仅展示（pointer-events-none），拖动/编辑仍在时间表进行。
 * 与课程重叠的块不绘制卡片（由 courseIndicators 显示课程卡右上角 Task Marker），
 * 与时间表行为一致。
 */
export function buildOverviewStudyBlockLayers(input: {
  studyBlocks: StudyBlock[];
  semester: Semester;
  currentSemesterWeek: number;
  schedules: CourseSchedule[];
}) {
  const { studyBlocks, semester, currentSemesterWeek, schedules } = input;
  const dateByDay = weekDateByDay(semester, currentSemesterWeek);

  return (ctx: {
    dayOfWeek: number;
    dayStartMinutes: number;
    totalMinutes: number;
    timeToMinutes: (t: string) => number;
  }): React.ReactNode => {
    const date = dateByDay.get(ctx.dayOfWeek);
    if (!date) return null;
    // 当前周该日生效课程（与 TimetableGrid daySchedules 同源）
    const daySchedules = schedules.filter(
      (s) => s.dayOfWeek === ctx.dayOfWeek && isScheduleActive(s, currentSemesterWeek)
    );
    const dayBlocks = studyBlocks
      .filter(
        (b) =>
          b.date === date &&
          // 与课程重叠：不绘制卡片（由 Task Marker 呈现），与时间表一致
          !daySchedules.some((s) => timeOverlap(b, s))
      )
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

/**
 * 总览课表课程卡右上角 Task Marker：与课程时间重叠的 StudyBlock 任务
 * 以单个标识点呈现（参考时间表 CourseTaskMarker 视觉：7px 圆点），
 * hover 显示重叠任务列表（原生 title）。与课程重叠的块不再单独绘制卡片。
 */
export function buildOverviewCourseTaskMarkers(input: {
  studyBlocks: StudyBlock[];
  semester: Semester;
  currentSemesterWeek: number;
}) {
  const { studyBlocks, semester, currentSemesterWeek } = input;
  const dateByDay = weekDateByDay(semester, currentSemesterWeek);

  return (ctx: {
    schedule: { startTime: string; endTime: string; id: string };
    dayOfWeek: number;
    hasConflict: boolean;
  }): React.ReactNode => {
    const date = dateByDay.get(ctx.dayOfWeek);
    if (!date) return null;
    const blocks = studyBlocks
      .filter((b) => b.date === date && timeOverlap(b, ctx.schedule))
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    if (blocks.length === 0) return null;
    const label = blocks.map((b) => `${b.title}（${b.startTime}–${b.endTime}）`).join("、");
    return (
      <div
        className="absolute z-[7] pointer-events-none"
        style={{ top: 4, right: ctx.hasConflict ? 26 : 6 }}
        aria-label={`${blocks.length} 个学习任务与本课程时间重叠`}
        title={`${blocks.length} 个学习任务与本课程时间重叠：${label}`}
      >
        <span className="block w-[7px] h-[7px] rounded-full bg-[#A87952]" />
      </div>
    );
  };
}
