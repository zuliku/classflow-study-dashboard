/**
 * Task 7G-C：数据依赖 / 级联删除纯逻辑（不触碰 Zustand / Notification / UI / Kiro）。
 * 只计算引用关系；禁止 generic dependency graph engine。
 * CalendarMark 匹配必须走 isDDLMarkForAssignment（严格 matcher），禁止 title/date 模糊猜测。
 */

import {
  Assignment,
  CalendarMark,
  Course,
  CourseSchedule,
  GroupProject,
  Material,
  Reminder,
  ScheduleOccurrenceOverride,
  StudyBlock,
} from "@/types";
import { isDDLMarkForAssignment, isLegacyDDLMarkForAssignment } from "@/lib/calendarMark";

export interface DependencyCollections {
  courses: Course[];
  schedules: CourseSchedule[];
  assignments: Assignment[];
  calendarMarks: CalendarMark[];
  groupProjects: GroupProject[];
  studyBlocks: StudyBlock[];
  reminders: Reminder[];
  /** Task 7：一次性停课/调课/补课 */
  scheduleOccurrenceOverrides?: ScheduleOccurrenceOverride[];
}

// ---------- Assignment ----------

export interface AssignmentDeleteSnapshot {
  assignment: Assignment;
  /** linked DDL CalendarMark（isDDLMarkForAssignment 严格匹配，含 legacy） */
  calendarMarks: CalendarMark[];
  /** block.assignmentId === assignment.id 的学习计划 */
  studyBlocks: StudyBlock[];
  /**
   * 三类 Reminder（scheduled / fired / skipped 全部进入）：
   * 1. targetType=assignment && targetId=assignment.id
   * 2. targetType=studyBlock && targetId ∈ deletedStudyBlockIds
   * 3. targetType=calendarMark && targetId ∈ deletedCalendarMarkIds（防止删除 linked DDL mark 后留下 orphan Reminder）
   */
  reminders: Reminder[];
}

export function collectAssignmentDeleteSnapshot(
  state: DependencyCollections,
  assignmentId: string
): AssignmentDeleteSnapshot | null {
  const assignment = state.assignments.find((a) => a.id === assignmentId);
  if (!assignment) return null;
  // 部分 fixture / 历史 state 可能缺 studyBlocks / reminders → 回落 []
  const studyBlocks = (state.studyBlocks ?? []).filter((b) => b.assignmentId === assignmentId);
  const calendarMarks = state.calendarMarks.filter((m) => isDDLMarkForAssignment(m, assignment));
  const deletedStudyBlockIds = new Set(studyBlocks.map((b) => b.id));
  const deletedCalendarMarkIds = new Set(calendarMarks.map((m) => m.id));
  const reminders = (state.reminders ?? []).filter(
    (r) =>
      (r.targetType === "assignment" && r.targetId === assignmentId) ||
      (r.targetType === "studyBlock" && r.targetId !== undefined && deletedStudyBlockIds.has(r.targetId)) ||
      (r.targetType === "calendarMark" && r.targetId !== undefined && deletedCalendarMarkIds.has(r.targetId))
  );
  return { assignment, calendarMarks, studyBlocks, reminders };
}

export function removeAssignmentDeleteSnapshot(
  state: DependencyCollections,
  snapshot: AssignmentDeleteSnapshot
): Pick<DependencyCollections, "assignments" | "calendarMarks" | "studyBlocks" | "reminders"> {
  const assignmentIds = new Set([snapshot.assignment.id]);
  const markIds = new Set(snapshot.calendarMarks.map((m) => m.id));
  const blockIds = new Set(snapshot.studyBlocks.map((b) => b.id));
  const reminderIds = new Set(snapshot.reminders.map((r) => r.id));
  return {
    assignments: state.assignments.filter((a) => !assignmentIds.has(a.id)),
    calendarMarks: state.calendarMarks.filter((m) => !markIds.has(m.id)),
    studyBlocks: (state.studyBlocks ?? []).filter((b) => !blockIds.has(b.id)),
    reminders: (state.reminders ?? []).filter((r) => !reminderIds.has(r.id)),
  };
}

/** 原对象原样插回（禁止 addAssignment/addStudyBlock/addReminder 重建）；按 ID 幂等，调用两次不重复 */
export function restoreAssignmentDeleteSnapshot(
  state: DependencyCollections,
  snapshot: AssignmentDeleteSnapshot
): Pick<DependencyCollections, "assignments" | "calendarMarks" | "studyBlocks" | "reminders"> {
  return {
    assignments: state.assignments.some((a) => a.id === snapshot.assignment.id)
      ? state.assignments
      : [...state.assignments, snapshot.assignment],
    calendarMarks: [
      ...state.calendarMarks,
      ...snapshot.calendarMarks.filter((m) => !state.calendarMarks.some((x) => x.id === m.id)),
    ],
    studyBlocks: [
      ...state.studyBlocks,
      ...snapshot.studyBlocks.filter((b) => !state.studyBlocks.some((x) => x.id === b.id)),
    ],
    reminders: [
      ...state.reminders,
      ...snapshot.reminders.filter((r) => !state.reminders.some((x) => x.id === r.id)),
    ],
  };
}

// ---------- Course ----------

export interface CourseDeleteCascade {
  course: Course;
  schedules: CourseSchedule[];
  assignments: Assignment[];
  /** 仅能确定性归属已删 Assignment 的 DDL marks（isDDLMarkForAssignment / legacy 严格匹配）；exam/activity 不动 */
  calendarMarks: CalendarMark[];
  groupProjects: GroupProject[];
  /** block.courseId === courseId OR block.assignmentId ∈ deletedAssignmentIds（两条件都要保留，覆盖历史/部分链接数据） */
  studyBlocks: StudyBlock[];
  reminders: Reminder[];
  /** Task 7：该课程的全部 scheduleOccurrenceOverrides（cancel/move/extra 都随课程删除） */
  scheduleOccurrenceOverrides: ScheduleOccurrenceOverride[];
}

export function collectCourseDeleteCascade(
  state: DependencyCollections,
  courseId: string
): CourseDeleteCascade | null {
  const course = state.courses.find((c) => c.id === courseId);
  if (!course) return null;
  const assignments = state.assignments.filter((a) => a.courseId === courseId);
  const deletedAssignmentIds = new Set(assignments.map((a) => a.id));
  const schedules = state.schedules.filter((s) => s.courseId === courseId);
  const groupProjects = state.groupProjects.filter((gp) => gp.courseId === courseId);
  const studyBlocks = state.studyBlocks.filter(
    (b) =>
      b.courseId === courseId ||
      (b.assignmentId !== undefined && deletedAssignmentIds.has(b.assignmentId))
  );
  const deletedStudyBlockIds = new Set(studyBlocks.map((b) => b.id));
  const calendarMarks = state.calendarMarks.filter(
    (m) =>
      m.type === "ddl" &&
      ((m.sourceId !== undefined && deletedAssignmentIds.has(m.sourceId)) ||
        (!m.sourceId && assignments.some((a) => isLegacyDDLMarkForAssignment(m, a))))
  );
  const deletedCalendarMarkIds = new Set(calendarMarks.map((m) => m.id));
  const reminders = state.reminders.filter(
    (r) =>
      (r.targetType === "assignment" && r.targetId !== undefined && deletedAssignmentIds.has(r.targetId)) ||
      (r.targetType === "studyBlock" && r.targetId !== undefined && deletedStudyBlockIds.has(r.targetId)) ||
      (r.targetType === "calendarMark" && r.targetId !== undefined && deletedCalendarMarkIds.has(r.targetId))
  );
  const scheduleOccurrenceOverrides = (state.scheduleOccurrenceOverrides ?? []).filter(
    (o) => o.courseId === courseId
  );
  return { course, schedules, assignments, calendarMarks, groupProjects, studyBlocks, reminders, scheduleOccurrenceOverrides };
}

export function removeCourseDeleteCascade(
  state: DependencyCollections,
  cascade: CourseDeleteCascade
): Pick<
  DependencyCollections,
  | "courses"
  | "schedules"
  | "assignments"
  | "calendarMarks"
  | "groupProjects"
  | "studyBlocks"
  | "reminders"
  | "scheduleOccurrenceOverrides"
> {
  const courseIds = new Set([cascade.course.id]);
  const scheduleIds = new Set(cascade.schedules.map((s) => s.id));
  const assignmentIds = new Set(cascade.assignments.map((a) => a.id));
  const markIds = new Set(cascade.calendarMarks.map((m) => m.id));
  const projectIds = new Set(cascade.groupProjects.map((gp) => gp.id));
  const blockIds = new Set(cascade.studyBlocks.map((b) => b.id));
  const reminderIds = new Set(cascade.reminders.map((r) => r.id));
  const overrideIds = new Set(cascade.scheduleOccurrenceOverrides.map((o) => o.id));
  return {
    courses: state.courses.filter((c) => !courseIds.has(c.id)),
    schedules: state.schedules.filter((s) => !scheduleIds.has(s.id)),
    assignments: state.assignments.filter((a) => !assignmentIds.has(a.id)),
    calendarMarks: state.calendarMarks.filter((m) => !markIds.has(m.id)),
    groupProjects: state.groupProjects.filter((gp) => !projectIds.has(gp.id)),
    studyBlocks: (state.studyBlocks ?? []).filter((b) => !blockIds.has(b.id)),
    reminders: (state.reminders ?? []).filter((r) => !reminderIds.has(r.id)),
    scheduleOccurrenceOverrides: (state.scheduleOccurrenceOverrides ?? []).filter(
      (o) => !overrideIds.has(o.id)
    ),
  };
}

/** Undo Course Delete：按原对象原样插回（保留原 ID；幂等） */
export function restoreCourseDeleteCascade(
  state: DependencyCollections,
  cascade: CourseDeleteCascade
): Pick<
  DependencyCollections,
  | "courses"
  | "schedules"
  | "assignments"
  | "calendarMarks"
  | "groupProjects"
  | "studyBlocks"
  | "reminders"
  | "scheduleOccurrenceOverrides"
> {
  const insert = <T extends { id: string }>(list: T[], items: T[]): T[] => [
    ...list,
    ...items.filter((x) => !list.some((y) => y.id === x.id)),
  ];
  return {
    courses: insert(state.courses, [cascade.course]),
    schedules: insert(state.schedules, cascade.schedules),
    assignments: insert(state.assignments, cascade.assignments),
    calendarMarks: insert(state.calendarMarks, cascade.calendarMarks),
    groupProjects: insert(state.groupProjects, cascade.groupProjects),
    studyBlocks: insert(state.studyBlocks, cascade.studyBlocks),
    reminders: insert(state.reminders, cascade.reminders),
    scheduleOccurrenceOverrides: insert(state.scheduleOccurrenceOverrides ?? [], cascade.scheduleOccurrenceOverrides),
  };
}


// ---------- CourseMaterial ----------

/**
 * Workflow UX V6：Material Delete Snapshot（relation-level，非整对象）。
 * Delete → Undo 必须是完整 inverse，但 Undo 只补回「被删的那条 relation」，
 * 不覆盖撤销窗口内的 concurrent relation edits（如用户新关联了资料 N）。
 */
export interface CourseMaterialDeleteSnapshot {
  courseId: string;
  material: Material;
  /** material 在 Course.materials 中原 index */
  materialIndex: number;
  /** 删除前真实引用该资料的 Assignment relation（同课程强约束；index = 原 materialIds 位置） */
  assignmentLinks: Array<{
    assignmentId: string;
    materialIndex: number;
  }>;
}

export function collectCourseMaterialDeleteSnapshot(
  state: Pick<DependencyCollections, "courses" | "assignments">,
  courseId: string,
  materialId: string
): CourseMaterialDeleteSnapshot | null {
  const course = state.courses.find((c) => c.id === courseId);
  if (!course) return null;
  const materialIndex = course.materials.findIndex((m) => m.id === materialId);
  if (materialIndex === -1) return null;
  const assignmentLinks = state.assignments.flatMap((a) => {
    if (a.courseId !== courseId || !a.materialIds) return [];
    const idx = a.materialIds.indexOf(materialId);
    return idx === -1 ? [] : [{ assignmentId: a.id, materialIndex: idx }];
  });
  return {
    courseId,
    material: course.materials[materialIndex],
    materialIndex,
    assignmentLinks,
  };
}

/** Delete：Course 删目标 Material + 同课程 Assignment 清该条 relation（空数组存 undefined 保持现有语义） */
export function removeCourseMaterialDeleteSnapshot(
  state: Pick<DependencyCollections, "courses" | "assignments">,
  snapshot: CourseMaterialDeleteSnapshot
): Pick<DependencyCollections, "courses" | "assignments"> {
  const materialId = snapshot.material.id;
  return {
    courses: state.courses.map((c) =>
      c.id !== snapshot.courseId
        ? c
        : { ...c, materials: c.materials.filter((m) => m.id !== materialId) }
    ),
    assignments: state.assignments.map((a) => {
      if (a.courseId !== snapshot.courseId || !a.materialIds?.includes(materialId)) return a;
      const rest = a.materialIds.filter((id) => id !== materialId);
      return { ...a, materialIds: rest.length > 0 ? rest : undefined };
    }),
  };
}

/**
 * Restore：relation-level merge，不是旧对象覆盖。
 * - Course 不存在 → null（不凭空重建 Course / orphan material）；调用方仍可清理 Blob。
 * - Material 按 snapshot.materialIndex 原顺序插回（bounded + 幂等）。
 * - Assignment relation 逐条校验：任务仍存在 / 未换课程 / relation 当前缺失 /
 *   material 已成功恢复——满足才按原 index（Math.min bounded）插回；
 *   Undo 窗口内的 concurrent edits（新增其它资料）原样保留。
 */
export function restoreCourseMaterialDeleteSnapshot(
  state: Pick<DependencyCollections, "courses" | "assignments">,
  snapshot: CourseMaterialDeleteSnapshot
): Pick<DependencyCollections, "courses" | "assignments"> | null {
  const courseIdx = state.courses.findIndex((c) => c.id === snapshot.courseId);
  if (courseIdx === -1) return null; // Course 已删除：不凭空重建 / 不生成 orphan material

  const course = state.courses[courseIdx];
  // Material 原顺序恢复（幂等：已存在不重复插入；bounded index）
  const materials = course.materials.some((m) => m.id === snapshot.material.id)
    ? course.materials
    : (() => {
        const next = [...course.materials];
        const index = Math.min(Math.max(snapshot.materialIndex, 0), next.length);
        next.splice(index, 0, snapshot.material);
        return next;
      })();

  // Assignment relation-level merge（逐条校验；concurrent edits 原样保留）
  const linksByAssignment = new Map(
    snapshot.assignmentLinks.map((l) => [l.assignmentId, l.materialIndex])
  );
  const assignments = state.assignments.map((a) => {
    const originalIndex = linksByAssignment.get(a.id);
    if (originalIndex === undefined) return a; // 非关联任务 / 已删除任务不重建
    if (a.courseId !== snapshot.courseId) return a; // 换课程 → 禁止跨课程 relation
    const ids = a.materialIds ?? [];
    if (ids.includes(snapshot.material.id)) return a; // 幂等
    const index = Math.min(originalIndex, ids.length);
    const next = [...ids.slice(0, index), snapshot.material.id, ...ids.slice(index)];
    return { ...a, materialIds: next };
  });

  return {
    courses: state.courses.map((c, i) => (i === courseIdx ? { ...c, materials } : c)),
    assignments,
  };
}