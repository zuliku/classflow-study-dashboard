/**
 * Workflow UX V8：Assignment 已有 StudyBlock 的 Timeline 定位规则（纯函数）。
 *
 * 选择策略（确定性）：
 * - 只考虑日期落在当前 Semester 范围内的 StudyBlock（学期外不可导航）
 * - 按 date + startTime 升序排序（输入未排序也 deterministic）
 * - 存在今天或未来的合法 block → 选最早一个（下一次尚未执行的学习计划）
 * - 全部在过去 → 选最近过去的一个（最近一次安排）
 *
 * 不做 DDL fallback：StudyBlock 与 DDL 是不同实体，DDL 不是学习时间位置。
 */

import { Semester, StudyBlock } from "@/types";
import { canOpenTimelineAtDate } from "@/lib/timeline/openTimelineAtDate";

export interface StudyScheduleTarget {
  block: StudyBlock;
  date: string;
}

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 输入接受 StudyBlock 的最小字段子集（date/startTime 参与排序；id 用于返回原对象） */
export function resolveStudyScheduleTimelineTarget(
  blocks: Pick<StudyBlock, "id" | "date" | "startTime">[],
  semester: Semester,
  today: Date
): { block: Pick<StudyBlock, "id" | "date" | "startTime"> } | null {
  const inSemester = blocks.filter((b) => canOpenTimelineAtDate(b.date, semester));
  if (inSemester.length === 0) return null;

  const todayKey = localDateKey(today);
  const sorted = [...inSemester].sort((a, b) =>
    `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`)
  );

  const upcoming = sorted.find((b) => b.date >= todayKey);
  const chosen = upcoming ?? sorted[sorted.length - 1];
  return chosen ? { block: chosen } : null;
}
