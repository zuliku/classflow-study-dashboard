/**
 * Timeline Projection（纯函数）：从 Domain Model 派生本周 Key Timeline 展示项。
 * - Assignment DDL 为 Source of Truth；对应 CalendarMark（sourceId 匹配）不重复显示
 * - 无具体时间的日期事件 → all-day（不伪造时间）
 * - 只有日期的事件 → all-day（不伪造时间）
 */

import { Assignment, CalendarMark, GroupProject, StudyBlock, Priority } from "@/types";
import { TimelineItem } from "@/lib/timeline/timelineTypes";
import { timeToMinutes } from "@/lib/timeline/timelineGeometry";

/** 本地 "YYYY-MM-DDTHH:mm" → date "YYYY-MM-DD" */
function ddlToDate(ddl: string): string {
  return ddl.slice(0, 10);
}

/** "YYYY-MM-DDTHH:mm:ss"（group task）→ date + HH:mm */
function groupDdlParts(ddl: string): { date: string; time: string } {
  const date = ddl.slice(0, 10);
  const time = ddl.length >= 16 ? ddl.slice(11, 16) : "";
  return { date, time: /^\d{2}:\d{2}$/.test(time) ? time : "" };
}

export interface DeriveTimelineInput {
  weekDates: string[]; // 本周日期 "YYYY-MM-DD"（7 天）
  assignments: Assignment[];
  calendarMarks: CalendarMark[];
  groupProjects: GroupProject[];
  studyBlocks: StudyBlock[];
  /** 课程 id → 课程名（hover 副信息） */
  courseNameOf?: (courseId: string) => string;
}

export function deriveTimelineItems(input: DeriveTimelineInput): TimelineItem[] {
  const { weekDates, assignments, calendarMarks, groupProjects, studyBlocks, courseNameOf } = input;
  const weekSet = new Set(weekDates);
  const items: TimelineItem[] = [];

  // ---- Assignment DDL（Source of Truth；未完成才醒目；Task V2：无 DDL 不生成 deadline item） ----
  const assignmentDdlIds = new Set<string>();
  for (const a of assignments) {
    if (a.status === "completed") continue;
    if (!a.ddl) continue;
    const date = ddlToDate(a.ddl);
    if (!weekSet.has(date)) continue;
    const time = a.ddl.slice(11, 16);
    assignmentDdlIds.add(a.id);
    items.push({
      id: `a-${a.id}`,
      sourceId: a.id,
      sourceType: "assignment",
      temporalType: "deadline",
      title: a.title,
      date,
      startTime: /^\d{2}:\d{2}$/.test(time) ? time : undefined,
      courseId: a.courseId,
      priority: a.priority,
      subtitle: courseNameOf ? courseNameOf(a.courseId) : undefined,
    });
  }

  // ---- CalendarMark（exam / activity / 独立 ddl）----
  for (const m of calendarMarks) {
    if (!weekSet.has(m.date)) continue;
    // DDL 去重：Assignment 已有 Source of Truth，其关联 mark 不重复显示
    if (m.type === "ddl" && m.sourceId && assignmentDdlIds.has(m.sourceId)) continue;
    if (m.type === "course") continue; // 课程由 Grid 展示
    const hasTime = timeToMinutes(m.startTime) !== null && timeToMinutes(m.endTime) !== null;
    items.push({
      id: `m-${m.id}`,
      sourceId: m.id,
      sourceType: m.type === "exam" ? "exam" : m.type === "activity" ? "activity" : "assignment",
      temporalType: m.type === "ddl" ? "deadline" : hasTime ? "interval" : "all-day",
      title: m.title,
      date: m.date,
      startTime: m.startTime,
      endTime: m.endTime,
    });
  }

  // ---- GroupTask DDL（小组节点）----
  for (const p of groupProjects) {
    for (const t of p.tasks) {
      if (t.completed) continue;
      const { date, time } = groupDdlParts(t.ddl);
      if (!weekSet.has(date)) continue;
      items.push({
        id: `gt-${p.id}-${t.id}`,
        sourceId: t.id,
        sourceType: "group-task",
        temporalType: "deadline",
        title: t.title,
        date,
        startTime: time || undefined,
        courseId: p.courseId,
        subtitle: courseNameOf ? courseNameOf(p.courseId) : undefined,
      });
    }
  }

  // ---- StudyBlock（只供 Shelf 判断「已安排」，不进入 Key Timeline）----
  void studyBlocks;

  return items;
}

/** Unscheduled Shelf：未完成且本周无对应 StudyBlock 的 Assignment */
export function deriveUnscheduledAssignments(input: {
  assignments: Assignment[];
  studyBlocks: StudyBlock[];
}): Assignment[] {
  const { assignments, studyBlocks } = input;
  const scheduledIds = new Set(
    studyBlocks.map((b) => b.assignmentId).filter((id): id is string => !!id)
  );
  return assignments.filter(
    (a) => a.status !== "completed" && !scheduledIds.has(a.id)
  );
}
