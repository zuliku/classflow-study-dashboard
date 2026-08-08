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
  /** groupTask.assigneeId 指向不存在的成员（只报告，不猜测负责人） */
  orphanGroupTaskAssignments: { projectId: string; taskId: string; taskTitle: string; assigneeId: string }[];
}

export function findDataIntegrityIssues(snapshot: DataSnapshot): DataIntegrityIssues {
  const courseIds = new Set(snapshot.courses.map((c) => c.id));
  const assignmentIds = new Set(snapshot.assignments.map((a) => a.id));

  const orphanGroupTaskAssignments: DataIntegrityIssues["orphanGroupTaskAssignments"] = [];
  for (const project of snapshot.groupProjects) {
    const memberIds = new Set(project.members.map((m) => m.id));
    for (const task of project.tasks) {
      if (task.assigneeId && !memberIds.has(task.assigneeId)) {
        orphanGroupTaskAssignments.push({
          projectId: project.id,
          taskId: task.id,
          taskTitle: task.title,
          assigneeId: task.assigneeId,
        });
      }
    }
  }

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
    orphanGroupTaskAssignments,
  };
}

/** 完整性问题的严重度分类：fatal 阻止恢复，warnings 仅提示（不自动猜测/重绑） */
export interface ClassifiedIntegrityIssues {
  fatal: string[];
  warnings: string[];
}

export function classifyIntegrityIssues(issues: DataIntegrityIssues): ClassifiedIntegrityIssues {
  const fatal: string[] = [];
  const warnings: string[] = [];

  if (issues.orphanSchedules.length > 0) {
    fatal.push(`${issues.orphanSchedules.length} 个排课引用了不存在的课程`);
  }
  if (issues.orphanAssignments.length > 0) {
    fatal.push(`${issues.orphanAssignments.length} 个任务引用了不存在的课程`);
  }
  if (issues.orphanGroupProjects.length > 0) {
    fatal.push(`${issues.orphanGroupProjects.length} 个小组项目引用了不存在的课程`);
  }
  if (issues.orphanDDLMarks.length > 0) {
    warnings.push(`${issues.orphanDDLMarks.length} 个日历标记指向已不存在的任务`);
  }
  if (issues.orphanGroupTaskAssignments.length > 0) {
    warnings.push(`${issues.orphanGroupTaskAssignments.length} 个任务负责人不存在，将保持未分配`);
  }
  if (issues.unlinkedLegacyDDLMarks.length > 0) {
    warnings.push(`${issues.unlinkedLegacyDDLMarks.length} 个旧日历标记未与任务关联`);
  }

  return { fatal, warnings };
}
