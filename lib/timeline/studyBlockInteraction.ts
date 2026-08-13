import { Assignment, StudyBlock } from "@/types";
import { timeToMinutes } from "@/lib/timeline/timelineGeometry";
import {
  snapMinutes,
  minutesToTime,
  TIMETABLE_DAY_START_MINUTES,
  TIMETABLE_DAY_END_MINUTES,
} from "@/lib/timetableInteraction";

/**
 * StudyBlock 直接拖动（IM5A：Move only）纯逻辑。
 * 只处理「拖动修改 date / startTime / endTime（保持时长）」；resize 留给后续（无最小时长 Domain 约束）。
 */

/** StudyBlock 时长（分钟）；非法时间回退 60min */
export function getStudyBlockDuration(block: Pick<StudyBlock, "startTime" | "endTime">): number {
  const s = timeToMinutes(block.startTime) ?? 0;
  const e = timeToMinutes(block.endTime) ?? s + 60;
  return Math.max(e - s, 0);
}

/** Move 起始时间 clamp：保持时长不变，start ∈ [08:00, 21:00 - duration]（duration 超界时下限优先） */
export function clampStudyBlockStart(startMinutes: number, duration: number): number {
  const maxStart = Math.max(TIMETABLE_DAY_END_MINUTES - duration, TIMETABLE_DAY_START_MINUTES);
  return Math.min(
    Math.max(Math.round(startMinutes), TIMETABLE_DAY_START_MINUTES),
    maxStart
  );
}

/**
 * 移动候选：duration 不变；start = pointer - offset → snap 15min → clamp；
 * 只改 date / startTime / endTime，identity/domain 字段（id/title/assignmentId/courseId/source）原样保留。
 * 纯函数：不检查冲突、不写 Store（冲突由调用方用 studyBlockConflict 判定）。
 */
export function calculateMovedStudyBlock(
  block: StudyBlock,
  targetDate: string,
  pointerMinutes: number,
  pointerOffsetMinutes: number
): StudyBlock {
  const duration = getStudyBlockDuration(block);
  const start = clampStudyBlockStart(
    snapMinutes(pointerMinutes - pointerOffsetMinutes),
    duration
  );
  return {
    ...block,
    date: targetDate,
    startTime: minutesToTime(start),
    endTime: minutesToTime(start + duration),
  };
}

/** Same-position no-op 判断：date/startTime/endTime 完全相同（移动无变化时不提交、不 Toast） */
export function isSameStudyBlockPosition(
  a: Pick<StudyBlock, "date" | "startTime" | "endTime">,
  b: Pick<StudyBlock, "date" | "startTime" | "endTime">
): boolean {
  return a.date === b.date && a.startTime === b.startTime && a.endTime === b.endTime;
}

/**
 * Direct shelf drag 快速安排时长：固定 1 小时。
 * Direct drag uses one-hour quick scheduling; custom duration remains available through ArrangeSheet.
 * （Assignment.estimatedMinutes 是整任务预计耗时，与单次学习时段语义不同，不作为拖拽时长。）
 */
export const QUICK_SCHEDULE_DURATION_MINUTES = 60;

/**
 * Quick Schedule 候选（IM5B）：把待安排 Assignment 拖到 Timeline 某天/时间 →
 * 生成一个 1h StudyBlock 候选（不含 id，由 addStudyBlock 分配）。
 * pointer 对应 block start（无原块 offset）；15min snap；clamp 保证 start>=08:00、end<=21:00（duration 不变）。
 * 纯函数：不检查冲突、不写 Store。
 */
export function createQuickStudyBlockCandidate({
  assignment,
  date,
  pointerMinutes,
}: {
  assignment: Pick<Assignment, "id" | "title" | "courseId">;
  date: string;
  pointerMinutes: number;
}): Omit<StudyBlock, "id"> {
  const start = clampStudyBlockStart(
    snapMinutes(pointerMinutes),
    QUICK_SCHEDULE_DURATION_MINUTES
  );
  return {
    title: assignment.title,
    date,
    startTime: minutesToTime(start),
    endTime: minutesToTime(start + QUICK_SCHEDULE_DURATION_MINUTES),
    assignmentId: assignment.id,
    courseId: assignment.courseId,
    source: "manual",
  };
}
