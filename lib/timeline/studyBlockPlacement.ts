/**
 * StudyBlock Placement Domain（Task 5 Part C）：
 * StudyBlock ↔ Course 从 Hard Conflict 改为 SOFT OVERLAP（可存在）；
 * StudyBlock ↔ StudyBlock 仍是 HARD CONFLICT（禁止）。
 * 唯一 Source of Truth：analyzeStudyBlockPlacement()。
 * 纯函数：无 React、无 Store mutation。
 */

import { CourseSchedule, StudyBlock } from "@/types";
import { isScheduleActive, timeToMinutes } from "@/lib/schedule";

export interface CourseOverlap {
  scheduleId: string;
  courseId: string;
  courseName: string;
  startTime: string;
  endTime: string;
}

export interface StudyBlockHardConflict {
  kind: "study-block";
  blockId: string;
  title: string;
  startTime: string;
  endTime: string;
}

export interface StudyBlockPlacementAnalysis {
  /** 仅 StudyBlock ↔ StudyBlock 硬冲突（第一个命中） */
  hardConflict: StudyBlockHardConflict | null;
  /** 当前教学周实际生效课程的重叠（soft，允许存在） */
  courseOverlaps: CourseOverlap[];
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * 统一 Placement 分析：
 * - 课程重叠只检测 currentSemesterWeek 内 isScheduleActive 生效的排课（单双周 / excludedWeeks 一致）
 * - hardConflict 与 courseOverlaps 可同时非空（block 既压课程又压其他 StudyBlock）
 * - block.id 传入时排除自身（move/resize 场景）
 */
export function analyzeStudyBlockPlacement(
  block: { id?: string; date: string; startTime: string; endTime: string },
  state: {
    schedules: CourseSchedule[];
    studyBlocks: StudyBlock[];
    courses: { id: string; name: string }[];
    currentSemesterWeek: number;
  }
): StudyBlockPlacementAnalysis {
  const s = timeToMinutes(block.startTime) ?? 0;
  const e = timeToMinutes(block.endTime) ?? s + 60;
  const dow = new Date(`${block.date}T00:00:00`).getDay() || 7;

  const courseOverlaps: CourseOverlap[] = [];
  for (const sch of state.schedules) {
    if (sch.dayOfWeek !== dow) continue;
    if (!isScheduleActive(sch, state.currentSemesterWeek)) continue;
    const ss = timeToMinutes(sch.startTime) ?? 0;
    const se = timeToMinutes(sch.endTime) ?? ss + 60;
    if (overlaps(s, e, ss, se)) {
      courseOverlaps.push({
        scheduleId: sch.id,
        courseId: sch.courseId,
        courseName: state.courses.find((c) => c.id === sch.courseId)?.name ?? "未知课程",
        startTime: sch.startTime,
        endTime: sch.endTime,
      });
    }
  }

  for (const b of state.studyBlocks) {
    if (b.id === block.id || b.date !== block.date) continue;
    const bs = timeToMinutes(b.startTime) ?? 0;
    const be = timeToMinutes(b.endTime) ?? bs + 60;
    if (overlaps(s, e, bs, be)) {
      return {
        hardConflict: {
          kind: "study-block",
          blockId: b.id,
          title: b.title,
          startTime: b.startTime,
          endTime: b.endTime,
        },
        courseOverlaps,
      };
    }
  }

  return { hardConflict: null, courseOverlaps };
}

/** 人工安排 Toast 后缀文案：无重叠 → ""；1 门 → 「，与《X》时间重叠」；多门 → 「，与 N 门课程时间重叠」 */
export function courseOverlapSuffix(overlaps: CourseOverlap[]): string {
  if (overlaps.length === 0) return "";
  if (overlaps.length === 1) return `，与《${overlaps[0].courseName}》时间重叠`;
  return `，与 ${overlaps.length} 门课程时间重叠`;
}
