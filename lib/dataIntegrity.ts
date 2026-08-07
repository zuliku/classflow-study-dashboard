import { Assignment, CalendarMark, Course, CourseSchedule, GroupProject } from "@/types";

/**
 * 数据完整性快照检查：仅报告，绝不自动修复/重新绑定。
 *
 * 原则（Release Hardening Task 3 第八节）：
 * - 检测到孤儿 schedule 时，不猜测 course，只报告；
 * - DDL mark 的 sourceId 指向不存在的 Assignment 时，报告问题，
 *   不静默重新绑定到标题相似的任务。
 */

export interface DataSnapshot {
  courses: Course[];
  schedules: CourseSchedule[];
  assignments: Assignment[];
  calendarMarks: CalendarMark[];
  groupProjects: GroupProject[];
}

export interface DataIntegrityIssues {
  /** schedule.courseId 无对应课程 */
  orphanSchedules: CourseSchedule[];
  /** assignment.courseId 无对应课程 */
  orphanAssignments: Assignment[];
  /** groupProject.courseId 无对应课程 */
  orphanGroupProjects: GroupProject[];
  /** ddl mark 的 sourceId 指向不存在的 Assignment */
  orphanDDLMarks: CalendarMark[];
  /** 无 sourceId 的历史遗留 ddl mark（信息性：等待唯一配对升级） */
  unlinkedLegacyDDLMarks: CalendarMark[];
}

export function findDataIntegrityIssues(snapshot: DataSnapshot): DataIntegrityIssues {
  const courseIds = new Set(snapshot.courses.map((c) => c.id));
  const assignmentIds = new Set(snapshot.assignments.map((a) => a.id));

  return {
    orphanSchedules: snapshot.schedules.filter((s) => !courseIds.has(s.courseId)),
    orphanAssignments: snapshot.assignments.filter((a) => !courseIds.has(a.courseId)),
    orphanGroupProjects: snapshot.groupProjects.filter((gp) => !courseIds.has(gp.courseId)),
    orphanDDLMarks: snapshot.calendarMarks.filter(
      (m) => !!m.sourceId && !assignmentIds.has(m.sourceId)
    ),
    unlinkedLegacyDDLMarks: snapshot.calendarMarks.filter(
      (m) => m.type === "ddl" && !m.sourceId
    ),
  };
}
