import { Assignment, CalendarMark, Course, CourseSchedule, GroupProject, Reminder, StudyBlock } from "@/types";

/**
 * 数据完整性快照检查：仅报告，绝不自动修复/重新绑定。
 *
 * 原则：
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
  /** Task 7G-C：学习计划（旧 fixture 可缺失 → []） */
  studyBlocks?: StudyBlock[];
  /** Task 7G-C：Reminder（旧 fixture 可缺失 → []） */
  reminders?: Reminder[];
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
  /** Task 6A：assignment.materialIds 引用其所属 Course 中不存在的资料（只报告，不猜测重绑） */
  orphanAssignmentMaterialRefs: { assignmentId: string; assignmentTitle: string; missingMaterialIds: string[] }[];
  /** Task 7G-C：studyBlock.courseId / assignmentId 指向不存在实体（只报告，不清空/不重绑） */
  orphanStudyBlocks: {
    studyBlockId: string;
    title: string;
    missingCourseId?: string;
    missingAssignmentId?: string;
  }[];
  /** Task 7G-C：Reminder target 指向不存在实体（standalone 合法；只报告，不转 standalone） */
  orphanReminderTargets: { reminderId: string; reminderTitle: string; targetType: string; missingTargetId: string }[];
}

export function findDataIntegrityIssues(snapshot: DataSnapshot): DataIntegrityIssues {
  const courseIds = new Set(snapshot.courses.map((c) => c.id));
  const assignmentIds = new Set(snapshot.assignments.map((a) => a.id));
  const studyBlocks = snapshot.studyBlocks ?? [];
  const reminders = snapshot.reminders ?? [];

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

  // Task 6A：任务关联了不存在（或跨课程）的资料 ID → 只报告（正常删除流程已清理，出现即异常）
  const materialIdsByCourse = new Map(
    snapshot.courses.map((c) => [c.id, new Set(c.materials.map((m) => m.id))])
  );
  const orphanAssignmentMaterialRefs: DataIntegrityIssues["orphanAssignmentMaterialRefs"] = [];
  for (const a of snapshot.assignments) {
    if (!a.materialIds || a.materialIds.length === 0) continue;
    const valid = materialIdsByCourse.get(a.courseId);
    const missing = a.materialIds.filter((id) => !valid?.has(id));
    if (missing.length > 0) {
      orphanAssignmentMaterialRefs.push({
        assignmentId: a.id,
        assignmentTitle: a.title,
        missingMaterialIds: missing,
      });
    }
  }

  // Task 7G-C：学习计划 orphan（courseId / assignmentId 任一存在但找不到目标 → 报告；不清空/不重绑）
  const orphanStudyBlocks: DataIntegrityIssues["orphanStudyBlocks"] = [];
  for (const b of studyBlocks) {
    const missingCourseId = b.courseId && !courseIds.has(b.courseId) ? b.courseId : undefined;
    const missingAssignmentId = b.assignmentId && !assignmentIds.has(b.assignmentId) ? b.assignmentId : undefined;
    if (missingCourseId !== undefined || missingAssignmentId !== undefined) {
      orphanStudyBlocks.push({
        studyBlockId: b.id,
        title: b.title,
        missingCourseId,
        missingAssignmentId,
      });
    }
  }

  // Task 7G-C：Reminder target orphan（standalone 无 targetId 合法；其余 target 必须存在）
  const studyBlockIdSet = new Set(studyBlocks.map((b) => b.id));
  const calendarMarkIdSet = new Set(snapshot.calendarMarks.map((m) => m.id));
  const orphanReminderTargets: DataIntegrityIssues["orphanReminderTargets"] = [];
  for (const r of reminders) {
    if (r.targetType === "standalone") continue; // 独立提醒无 target 合法
    if (!r.targetId) continue; // 缺 targetId 但非 standalone：记录
    const exists =
      r.targetType === "assignment"
        ? assignmentIds.has(r.targetId)
        : r.targetType === "studyBlock"
          ? studyBlockIdSet.has(r.targetId)
          : r.targetType === "calendarMark"
            ? calendarMarkIdSet.has(r.targetId)
            : false;
    if (!exists) {
      orphanReminderTargets.push({
        reminderId: r.id,
        reminderTitle: r.title,
        targetType: r.targetType,
        missingTargetId: r.targetId,
      });
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
    orphanAssignmentMaterialRefs,
    orphanStudyBlocks,
    orphanReminderTargets,
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
  if (issues.orphanAssignmentMaterialRefs.length > 0) {
    warnings.push(`${issues.orphanAssignmentMaterialRefs.length} 个任务关联了已不存在的课程资料`);
  }
  if (issues.orphanStudyBlocks.length > 0) {
    fatal.push(`${issues.orphanStudyBlocks.length} 个学习计划引用了不存在的课程或任务`);
  }
  if (issues.orphanReminderTargets.length > 0) {
    warnings.push(`${issues.orphanReminderTargets.length} 个提醒指向已不存在的目标`);
  }

  return { fatal, warnings };
}
