/**
 * 共享 Task Planning Facts（Planner / Capacity Allocator / TaskHealth 共用，禁止重复实现）。
 * 语义：scheduledMinutes 只统计 Deadline 之前的 StudyBlock（同日 end <= deadline 时刻）；
 * Deadline 后的 StudyBlock 不计入该任务 coverage（但 Free Time Engine 仍把它视为 busy）。
 */

import { Assignment, StudyBlock } from "@/types";
import { parseLocalDDL } from "@/lib/ddl";
import { timeToMinutes } from "@/lib/timeline/timelineGeometry";

/** 该 StudyBlock 是否完全落在 Deadline 之前（同日 end <= deadline 时刻） */
export function blockBeforeDeadline(
  b: StudyBlock,
  deadlineDate: string,
  deadlineMinutes: number
): boolean {
  if (b.date < deadlineDate) return true;
  if (b.date > deadlineDate) return false;
  const end = timeToMinutes(b.endTime);
  return end !== null && end <= deadlineMinutes;
}

export function getScheduledMinutesBeforeDeadline(
  assignment: Assignment,
  studyBlocks: StudyBlock[]
): number {
  if (!assignment.ddl) return 0;
  const deadline = parseLocalDDL(assignment.ddl);
  if (!deadline) return 0;
  const dlDate = assignment.ddl.slice(0, 10);
  const dlMinutes = deadline.getHours() * 60 + deadline.getMinutes();
  return studyBlocks
    .filter((b) => b.assignmentId === assignment.id && blockBeforeDeadline(b, dlDate, dlMinutes))
    .reduce((sum, b) => {
      const s = timeToMinutes(b.startTime);
      const e = timeToMinutes(b.endTime);
      if (s === null || e === null || e <= s) return sum;
      return sum + (e - s);
    }, 0);
}
