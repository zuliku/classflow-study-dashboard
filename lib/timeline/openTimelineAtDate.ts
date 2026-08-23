/**
 * Temporal Deep Link（Workflow UX V2）：
 * 「在时间表查看」的精确周跳转唯一实现。
 *
 * 规则：
 * - 周次唯一来源 getSemesterWeek(date, semester)（本地日期语义）
 * - 学期内：先 setCurrentSemesterWeek(week) 再 setActiveTab("timetable")，
 *   避免 Timeline 首帧渲染旧周
 * - 学期范围外（week < 1 或 > totalWeeks）：不 clamp、不导航，返回 false——
 *   把用户带到错误的第 1/最后一周比不做跳转更糟；UI 应据此隐藏或禁用 action
 *
 * 刻意保持函数式轻量：不做 NavigationService / Router 子系统。
 */

import { Semester, NavTab } from "@/types";
import { getSemesterWeek } from "@/lib/semester";

/** 实体日期是否落在学期范围内（用于决定「在时间表查看」是否可用） */
export function canOpenTimelineAtDate(date: string, semester: Semester): boolean {
  const week = getSemesterWeek(`${date}T00:00:00`, semester);
  return week >= 1 && week <= semester.totalWeeks;
}

export interface OpenTimelineAtDateInput {
  /** 本地日期 "YYYY-MM-DD" */
  date: string;
  semester: Semester;
  setCurrentSemesterWeek: (week: number) => void;
  setActiveTab: (tab: NavTab) => void;
}

/** 精确跳到 date 所在教学周的时间表；学期外日期返回 false 且不产生任何状态变更 */
export function openTimelineAtDate(input: OpenTimelineAtDateInput): boolean {
  const { date, semester, setCurrentSemesterWeek, setActiveTab } = input;
  if (!canOpenTimelineAtDate(date, semester)) return false;
  setCurrentSemesterWeek(getSemesterWeek(`${date}T00:00:00`, semester));
  setActiveTab("timetable");
  return true;
}
