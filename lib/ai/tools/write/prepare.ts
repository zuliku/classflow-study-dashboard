/**
 * Write Tool Prepare（Task 8）：Single Write 与 Transaction 共享的 domain validation / projection / commit。
 * prepareKiroWriteTool(toolName, input, state) → PreparedWriteAction：
 *  - project(state)：把该操作投影到 state 克隆（Transaction 链式预检用）
 *  - commit(api, toolCallId)：真正写入 Store（返回 undo；null = 运行时失败）
 * 事务安全工具集 = 已有实体操作（无动态 ID 依赖）；create_* 保持独立执行路径。
 */

import {
  AppState,
} from "@/store/useAppStore";
import { KiroWriteApi, WriteToolResult } from "@/lib/ai/tools/write/types";
import { KIRO_WRITE_TOOL_SCHEMAS } from "@/lib/ai/tools/write/schemas";
import {
  validateScheduleCandidate,
  snapMinutes,
  minutesToTime,
  getScheduleDuration,
  clampScheduleMove,
  MIN_SCHEDULE_DURATION,
  TIMETABLE_DAY_END_MINUTES,
} from "@/lib/timetableInteraction";
import { timeToMinutes } from "@/lib/schedule";
import { TransactionSafeToolName } from "@/lib/ai/transactions/types";

export interface PreparedActionView {
  tool: string;
  entityType: "assignment" | "schedule" | "course" | "group-project" | "group-member" | "group-task";
  entityId: string;
  title: string;
  operation: "create" | "update" | "delete";
  before?: unknown;
  after?: unknown;
}

export interface PreparedWriteAction {
  ok: true;
  toolName: TransactionSafeToolName;
  view: PreparedActionView;
  /** 投影到 state 克隆（不改原对象） */
  project: (state: AppState) => AppState;
  /** 提交到 Store；返回 undo（null = 运行时失败，由事务层回滚） */
  commit: (api: KiroWriteApi, toolCallId: string) => { undo?: () => void } | null;
}

export type PreparedWriteResult =
  | PreparedWriteAction
  | { ok: false; code: string; message: string; details?: unknown };

type Fail = (code: string, message: string, details?: unknown) => PreparedWriteResult;

const notFound = (message: string): PreparedWriteResult => ({ ok: false, code: "NOT_FOUND", message });
const invalidInput = (message: string): PreparedWriteResult => ({ ok: false, code: "INVALID_INPUT", message });
const conflict = (message: string, details?: unknown): PreparedWriteResult => ({ ok: false, code: "CONFLICT", message, details });
const lastLeader = (message: string): PreparedWriteResult => ({ ok: false, code: "LAST_LEADER", message });

function safeParse<T>(toolName: TransactionSafeToolName, input: unknown): { ok: true; data: T } | { ok: false; code: "INVALID_INPUT"; message: string } {
  const parsed = KIRO_WRITE_TOOL_SCHEMAS[toolName].safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, code: "INVALID_INPUT", message: first ? `${first.path.join(".") || "输入"}: ${first.message}` : "输入不合法。" };
  }
  return { ok: true, data: parsed.data as T };
}

function courseNameOf(state: AppState, courseId: string): string {
  return state.courses.find((c) => c.id === courseId)?.name ?? "课程";
}

function scheduleTimeText(s: { dayOfWeek: number; startTime: string; endTime: string }): string {
  const dayNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  return `${dayNames[s.dayOfWeek - 1] ?? s.dayOfWeek} ${s.startTime}–${s.endTime}`;
}

function validTimeRange(start: string, end: string): boolean {
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  return s !== null && e !== null && e > s;
}

/** 排课冲突预检（对给定 state 的 schedules）——Single 与 Transaction 共享同一算法 */
function checkScheduleConflict(
  state: AppState,
  candidate: { id: string; courseId: string; dayOfWeek: number; startTime: string; endTime: string },
  excludeScheduleId: string
): PreparedWriteResult | null {
  const validation = validateScheduleCandidate(candidate as never, state.schedules, excludeScheduleId);
  if (!validation.valid && validation.conflict) {
    const other = validation.conflict.scheduleA.id === candidate.id
      ? validation.conflict.scheduleB
      : validation.conflict.scheduleA;
    const otherCourse = state.courses.find((c) => c.id === other.courseId);
    return conflict(
      `${scheduleTimeText(candidate)} 与《${otherCourse?.name ?? "另一门课"}》时间冲突，因此没有修改。`,
      { conflictingCourse: otherCourse?.name ?? null }
    );
  }
  return null;
}

function makeAction(
  state: AppState,
  view: PreparedActionView,
  project: (s: AppState) => AppState,
  commit: (api: KiroWriteApi, toolCallId: string) => { undo?: () => void } | null
): PreparedWriteAction {
  return { ok: true, toolName: view.tool as TransactionSafeToolName, view, project, commit };
}

function projectReplace<T>(state: AppState, key: "assignments" | "schedules" | "courses" | "groupProjects", id: string, next: T): AppState {
  return { ...state, [key]: (state[key] as { id: string }[]).map((x) => (x.id === id ? next : x)) };
}

function projectRemove(state: AppState, key: "assignments" | "schedules", id: string): AppState {
  return { ...state, [key]: (state[key] as { id: string }[]).filter((x) => x.id !== id) };
}

function projectGroup(state: AppState, projectId: string, updater: (p: AppState["groupProjects"][number]) => AppState["groupProjects"][number]): AppState {
  return {
    ...state,
    groupProjects: state.groupProjects.map((p) => (p.id === projectId ? updater(p) : p)),
  };
}

// ---------- Assignment ----------

function prepareUpdateAssignment(toolName: TransactionSafeToolName, input: unknown, state: AppState, fail: Fail): PreparedWriteResult {
  const parsed = safeParse<{ assignmentId: string; title?: string; description?: string; tags?: string[]; estimatedMinutes?: number | null }>(toolName, input);
  if (!parsed.ok) return parsed;
  const { assignmentId, title, description, tags, estimatedMinutes } = parsed.data;
  const before = state.assignments.find((a) => a.id === assignmentId);
  if (!before) return notFound("未找到对应任务。");
  const after = {
    ...before,
    title: title ?? before.title,
    description: description !== undefined ? description : before.description,
    tags: tags ?? before.tags,
    // estimatedMinutes：undefined = 不改变；null = 清除；number = 设置（store normalize 清洗）
    estimatedMinutes: estimatedMinutes === undefined ? before.estimatedMinutes : estimatedMinutes ?? undefined,
  };
  const view: PreparedActionView = {
    tool: toolName, entityType: "assignment", entityId: assignmentId, title: after.title, operation: "update",
    before: { title: before.title, description: before.description, tags: before.tags, estimatedMinutes: before.estimatedMinutes ?? null },
    after: { title: after.title, description: after.description, tags: after.tags, estimatedMinutes: after.estimatedMinutes ?? null },
  };
  const patch = {
    title: title !== undefined ? title : undefined,
    description: description !== undefined ? description : undefined,
    tags: tags !== undefined ? tags : undefined,
    estimatedMinutes: estimatedMinutes === undefined ? undefined : estimatedMinutes ?? undefined,
  };
  return makeAction(state, view,
    (s) => projectReplace(s, "assignments", assignmentId, after),
    (api, callId) => {
      api.updateAssignmentPatch(assignmentId, patch);
      return { undo: () => api.updateAssignment(before as never) };
    });
}

function prepareSetAssignmentDDL(toolName: TransactionSafeToolName, input: unknown, state: AppState, fail: Fail): PreparedWriteResult {
  const parsed = safeParse<{ assignmentId: string; ddl: string | null }>(toolName, input);
  if (!parsed.ok) return parsed;
  const { assignmentId, ddl } = parsed.data;
  const before = state.assignments.find((a) => a.id === assignmentId);
  if (!before) return notFound("未找到对应任务。");
  // null = 清除截止时间（CalendarMark 由 Store 三态同步删除，工具不直接操作 CalendarMark）
  const after = { ...before, ddl: ddl ?? undefined };
  const view: PreparedActionView = {
    tool: toolName, entityType: "assignment", entityId: assignmentId, title: before.title, operation: "update",
    before: { ddl: before.ddl ?? null }, after: { ddl: ddl ?? null },
  };
  return makeAction(state, view,
    (s) => projectReplace(s, "assignments", assignmentId, after),
    (api, callId) => {
      api.updateAssignmentPatch(assignmentId, { ddl: ddl ?? undefined });
      return { undo: () => api.updateAssignment(before as never) };
    });
}

function prepareSetAssignmentPriority(toolName: TransactionSafeToolName, input: unknown, state: AppState, fail: Fail): PreparedWriteResult {
  const parsed = safeParse<{ assignmentId: string; priority: string }>(toolName, input);
  if (!parsed.ok) return parsed;
  const { assignmentId, priority } = parsed.data;
  const before = state.assignments.find((a) => a.id === assignmentId);
  if (!before) return notFound("未找到对应任务。");
  const after = { ...before, priority: priority as never };
  const view: PreparedActionView = {
    tool: toolName, entityType: "assignment", entityId: assignmentId, title: before.title, operation: "update",
    before: { priority: before.priority }, after: { priority },
  };
  return makeAction(state, view,
    (s) => projectReplace(s, "assignments", assignmentId, after),
    (api, callId) => {
      api.updateAssignmentPriority(assignmentId, priority as never);
      return { undo: () => api.updateAssignment(before as never) };
    });
}

function prepareSetAssignmentStatus(toolName: TransactionSafeToolName, input: unknown, state: AppState, fail: Fail): PreparedWriteResult {
  const parsed = safeParse<{ assignmentId: string; status: string }>(toolName, input);
  if (!parsed.ok) return parsed;
  const { assignmentId, status } = parsed.data;
  const before = state.assignments.find((a) => a.id === assignmentId);
  if (!before) return notFound("未找到对应任务。");
  const after = { ...before, status: status as never };
  const view: PreparedActionView = {
    tool: toolName, entityType: "assignment", entityId: assignmentId, title: before.title, operation: "update",
    before: { status: before.status }, after: { status },
  };
  return makeAction(state, view,
    (s) => projectReplace(s, "assignments", assignmentId, after),
    (api, callId) => {
      api.updateAssignmentStatus(assignmentId, status as never); // 保留 completed → progress 100 语义
      return { undo: () => api.updateAssignment(before as never) };
    });
}

function prepareSetAssignmentProgress(toolName: TransactionSafeToolName, input: unknown, state: AppState, fail: Fail): PreparedWriteResult {
  const parsed = safeParse<{ assignmentId: string; progress: number }>(toolName, input);
  if (!parsed.ok) return parsed;
  const { assignmentId, progress } = parsed.data;
  const before = state.assignments.find((a) => a.id === assignmentId);
  if (!before) return notFound("未找到对应任务。");
  const after = { ...before, progress };
  const view: PreparedActionView = {
    tool: toolName, entityType: "assignment", entityId: assignmentId, title: before.title, operation: "update",
    before: { progress: before.progress }, after: { progress },
  };
  return makeAction(state, view,
    (s) => projectReplace(s, "assignments", assignmentId, after),
    (api, callId) => {
      api.updateAssignmentProgress(assignmentId, progress); // status 由 store 自动同步
      return { undo: () => api.updateAssignment(before as never) };
    });
}

function prepareToggleAssignmentSubtask(toolName: TransactionSafeToolName, input: unknown, state: AppState, fail: Fail): PreparedWriteResult {
  const parsed = safeParse<{ assignmentId: string; subtaskId: string }>(toolName, input);
  if (!parsed.ok) return parsed;
  const { assignmentId, subtaskId } = parsed.data;
  const before = state.assignments.find((a) => a.id === assignmentId);
  if (!before) return notFound("未找到对应任务。");
  const target = before.subtasks?.find((st) => st.id === subtaskId);
  if (!target) return notFound("未找到对应子任务。");
  const after = {
    ...before,
    subtasks: (before.subtasks ?? []).map((st) => (st.id === subtaskId ? { ...st, completed: !st.completed } : st)),
  };
  const view: PreparedActionView = {
    tool: toolName, entityType: "assignment", entityId: assignmentId, title: before.title, operation: "update",
    before: { subtaskId, completed: target.completed }, after: { subtaskId, completed: !target.completed },
  };
  return makeAction(state, view,
    (s) => projectReplace(s, "assignments", assignmentId, after),
    (api, callId) => {
      api.toggleSubtask(assignmentId, subtaskId);
      return { undo: () => api.toggleSubtask(assignmentId, subtaskId) }; // 再次切换即恢复

    });
}

function prepareDeleteAssignment(toolName: TransactionSafeToolName, input: unknown, state: AppState, fail: Fail): PreparedWriteResult {
  const parsed = safeParse<{ assignmentId: string }>(toolName, input);
  if (!parsed.ok) return parsed;
  const { assignmentId } = parsed.data;
  const before = state.assignments.find((a) => a.id === assignmentId);
  if (!before) return notFound("未找到对应任务。");
  const view: PreparedActionView = {
    tool: toolName, entityType: "assignment", entityId: assignmentId, title: before.title, operation: "delete",
    before: { title: before.title, ddl: before.ddl },
  };
  return makeAction(state, view,
    (s) => projectRemove(s, "assignments", assignmentId),
    (api, callId) => {
      const removed = api.deleteAssignment(assignmentId);
      if (!removed) return null;
      return { undo: () => api.restoreAssignment(removed.assignment, removed.marks) };
    });
}

// ---------- Schedule ----------

function prepareMoveSchedule(toolName: TransactionSafeToolName, input: unknown, state: AppState, fail: Fail): PreparedWriteResult {
  const parsed = safeParse<{ scheduleId: string; dayOfWeek: number; startTime: string }>(toolName, input);
  if (!parsed.ok) return parsed;
  const { scheduleId, dayOfWeek, startTime } = parsed.data;
  const before = state.schedules.find((s) => s.id === scheduleId);
  if (!before) return notFound("未找到对应排课。");
  const start = clampScheduleMove(before, snapMinutes(timeToMinutes(startTime) ?? 480));
  const duration = getScheduleDuration(before);
  const after = { ...before, dayOfWeek, startTime: minutesToTime(start), endTime: minutesToTime(start + duration) };
  const conflictResult = checkScheduleConflict(state, after, scheduleId);
  if (conflictResult) return conflictResult;
  const view: PreparedActionView = {
    tool: toolName, entityType: "schedule", entityId: scheduleId, title: courseNameOf(state, before.courseId), operation: "update",
    before: { dayOfWeek: before.dayOfWeek, startTime: before.startTime, endTime: before.endTime },
    after: { dayOfWeek, startTime: after.startTime, endTime: after.endTime },
  };
  return makeAction(state, view,
    (s) => projectReplace(s, "schedules", scheduleId, after),
    (api, callId) => {
      api.updateSchedule(after as never);
      return { undo: () => api.updateSchedule(before as never) };
    });
}

function prepareResizeSchedule(toolName: TransactionSafeToolName, input: unknown, state: AppState, fail: Fail): PreparedWriteResult {
  const parsed = safeParse<{ scheduleId: string; endTime: string }>(toolName, input);
  if (!parsed.ok) return parsed;
  const { scheduleId, endTime } = parsed.data;
  const before = state.schedules.find((s) => s.id === scheduleId);
  if (!before) return notFound("未找到对应排课。");
  const start = timeToMinutes(before.startTime) ?? 480;
  let end = snapMinutes(timeToMinutes(endTime) ?? 480);
  const minEnd = start + MIN_SCHEDULE_DURATION;
  end = Math.min(Math.max(end, minEnd), TIMETABLE_DAY_END_MINUTES);
  if (end <= start) end = TIMETABLE_DAY_END_MINUTES;
  const after = { ...before, endTime: minutesToTime(end) };
  const conflictResult = checkScheduleConflict(state, after, scheduleId);
  if (conflictResult) return conflictResult;
  const view: PreparedActionView = {
    tool: toolName, entityType: "schedule", entityId: scheduleId, title: courseNameOf(state, before.courseId), operation: "update",
    before: { startTime: before.startTime, endTime: before.endTime },
    after: { startTime: before.startTime, endTime: after.endTime },
  };
  return makeAction(state, view,
    (s) => projectReplace(s, "schedules", scheduleId, after),
    (api, callId) => {
      api.updateSchedule(after as never);
      return { undo: () => api.updateSchedule(before as never) };
    });
}

function prepareUpdateSchedule(toolName: TransactionSafeToolName, input: unknown, state: AppState, fail: Fail): PreparedWriteResult {
  const parsed = safeParse<{ scheduleId: string; dayOfWeek?: number; startTime?: string; endTime?: string; location?: string; weeks?: string }>(toolName, input);
  if (!parsed.ok) return parsed;
  const { scheduleId, ...patch } = parsed.data;
  const before = state.schedules.find((s) => s.id === scheduleId);
  if (!before) return notFound("未找到对应排课。");
  const after = { ...before, ...patch } as typeof before;
  if (after.startTime && after.endTime && !validTimeRange(after.startTime, after.endTime)) {
    return invalidInput("结束时间必须晚于开始时间。");
  }
  if (patch.dayOfWeek !== undefined || patch.startTime !== undefined || patch.endTime !== undefined || patch.weeks !== undefined) {
    const conflictResult = checkScheduleConflict(state, after, scheduleId);
    if (conflictResult) return conflictResult;
  }
  const view: PreparedActionView = {
    tool: toolName, entityType: "schedule", entityId: scheduleId, title: courseNameOf(state, before.courseId), operation: "update",
    before: { dayOfWeek: before.dayOfWeek, startTime: before.startTime, endTime: before.endTime, location: before.location, weeks: before.weeks },
    after: { dayOfWeek: after.dayOfWeek, startTime: after.startTime, endTime: after.endTime, location: after.location, weeks: after.weeks },
  };
  return makeAction(state, view,
    (s) => projectReplace(s, "schedules", scheduleId, after),
    (api, callId) => {
      api.updateSchedule(after as never);
      return { undo: () => api.updateSchedule(before as never) };
    });
}

function prepareExcludeScheduleWeek(toolName: TransactionSafeToolName, input: unknown, state: AppState, fail: Fail): PreparedWriteResult {
  const parsed = safeParse<{ scheduleId: string; week: number }>(toolName, input);
  if (!parsed.ok) return parsed;
  const { scheduleId, week } = parsed.data;
  const before = state.schedules.find((s) => s.id === scheduleId);
  if (!before) return notFound("未找到对应排课。");
  if (week < 1 || week > state.semester.totalWeeks) return invalidInput(`教学周 ${week} 超出本学期范围。`);
  const after = { ...before, excludedWeeks: [...(before.excludedWeeks ?? []), week] };
  const view: PreparedActionView = {
    tool: toolName, entityType: "schedule", entityId: scheduleId, title: courseNameOf(state, before.courseId), operation: "update",
    before: { excludedWeeks: before.excludedWeeks ?? [] }, after: { excludedWeeks: after.excludedWeeks },
  };
  return makeAction(state, view,
    (s) => projectReplace(s, "schedules", scheduleId, after),
    (api, callId) => {
      api.excludeWeekFromSchedule(scheduleId, week);
      return { undo: () => api.updateSchedule(before as never) };
    });
}

function prepareDeleteSchedule(toolName: TransactionSafeToolName, input: unknown, state: AppState, fail: Fail): PreparedWriteResult {
  const parsed = safeParse<{ scheduleId: string }>(toolName, input);
  if (!parsed.ok) return parsed;
  const { scheduleId } = parsed.data;
  const before = state.schedules.find((s) => s.id === scheduleId);
  if (!before) return notFound("未找到对应排课。");
  const view: PreparedActionView = {
    tool: toolName, entityType: "schedule", entityId: scheduleId, title: courseNameOf(state, before.courseId), operation: "delete",
    before: { dayOfWeek: before.dayOfWeek, startTime: before.startTime, endTime: before.endTime },
  };
  return makeAction(state, view,
    (s) => projectRemove(s, "schedules", scheduleId),
    (api, callId) => {
      const removed = api.deleteSchedule(scheduleId);
      if (!removed) return null;
      return { undo: () => api.restoreSchedule(removed) };
    });
}

// ---------- Course ----------

function prepareUpdateCourse(toolName: TransactionSafeToolName, input: unknown, state: AppState, fail: Fail): PreparedWriteResult {
  const parsed = safeParse<{ courseId: string; name?: string; code?: string; teacher?: string; classroom?: string; credit?: number; description?: string }>(toolName, input);
  if (!parsed.ok) return parsed;
  const { courseId, ...patch } = parsed.data;
  const before = state.courses.find((c) => c.id === courseId);
  if (!before) return notFound("未找到对应课程。");
  const after = { ...before, ...patch };
  const view: PreparedActionView = {
    tool: toolName, entityType: "course", entityId: courseId, title: after.name, operation: "update",
    before: { name: before.name, code: before.code, teacher: before.teacher, classroom: before.classroom, credit: before.credit, description: before.description },
    after: { name: after.name, code: after.code, teacher: after.teacher, classroom: after.classroom, credit: after.credit, description: after.description },
  };
  return makeAction(state, view,
    (s) => projectReplace(s, "courses", courseId, after),
    (api, callId) => {
      api.updateCourse(after as never);
      return { undo: () => api.updateCourse(before as never) };
    });
}

// ---------- Group ----------

function prepareUpdateGroupProject(toolName: TransactionSafeToolName, input: unknown, state: AppState, fail: Fail): PreparedWriteResult {
  const parsed = safeParse<{ projectId: string; title?: string; description?: string }>(toolName, input);
  if (!parsed.ok) return parsed;
  const { projectId, title, description } = parsed.data;
  const before = state.groupProjects.find((p) => p.id === projectId);
  if (!before) return notFound("未找到对应小组项目。");
  const after = { ...before, title: title ?? before.title, description: description !== undefined ? description : before.description };
  const view: PreparedActionView = {
    tool: toolName, entityType: "group-project", entityId: projectId, title: after.title, operation: "update",
    before: { title: before.title, description: before.description },
    after: { title: after.title, description: after.description },
  };
  return makeAction(state, view,
    (s) => projectReplace(s, "groupProjects", projectId, after),
    (api, callId) => {
      api.updateGroupProject(projectId, { title: after.title, description: after.description });
      return { undo: () => api.updateGroupProject(projectId, { title: before.title, description: before.description }) };
    });
}

function prepareUpdateGroupMember(toolName: TransactionSafeToolName, input: unknown, state: AppState, fail: Fail): PreparedWriteResult {
  const parsed = safeParse<{ projectId: string; memberId: string; name?: string; role?: string; major?: string }>(toolName, input);
  if (!parsed.ok) return parsed;
  const { projectId, memberId, name, role, major } = parsed.data;
  const project = state.groupProjects.find((p) => p.id === projectId);
  if (!project) return notFound("未找到对应小组项目。");
  const before = project.members.find((m) => m.id === memberId);
  if (!before) return notFound("未找到对应成员。");
  // Leader 规则：禁止降级最后一个 leader（对 projected members 检查）
  if (role === "member" && before.role === "leader") {
    const leaderCount = project.members.filter((m) => m.role === "leader").length;
    if (leaderCount <= 1) return lastLeader("该成员是项目中唯一的负责人，不能降级。");
  }
  const afterMember = {
    ...before,
    name: name ?? before.name,
    role: (role as never) ?? before.role,
    major: major !== undefined ? major : before.major,
  };
  const after = { ...project, members: project.members.map((m) => (m.id === memberId ? afterMember : m)) };
  const view: PreparedActionView = {
    tool: toolName, entityType: "group-member", entityId: memberId, title: afterMember.name, operation: "update",
    before: { name: before.name, role: before.role, major: before.major },
    after: { name: afterMember.name, role: afterMember.role, major: afterMember.major },
  };
  return makeAction(state, view,
    (s) => projectGroup(s, projectId, () => after),
    (api, callId) => {
      api.updateGroupMember(projectId, afterMember as never);
      return { undo: () => api.updateGroupMember(projectId, before as never) };
    });
}

function prepareUpdateGroupTask(toolName: TransactionSafeToolName, input: unknown, state: AppState, fail: Fail): PreparedWriteResult {
  const parsed = safeParse<{ projectId: string; taskId: string; title?: string }>(toolName, input);
  if (!parsed.ok) return parsed;
  const { projectId, taskId, title } = parsed.data;
  const project = state.groupProjects.find((p) => p.id === projectId);
  if (!project) return notFound("未找到对应小组项目。");
  const before = project.tasks.find((t) => t.id === taskId);
  if (!before) return notFound("未找到对应小组任务。");
  const afterTask = { ...before, title: title ?? before.title };
  const after = { ...project, tasks: project.tasks.map((t) => (t.id === taskId ? afterTask : t)) };
  const view: PreparedActionView = {
    tool: toolName, entityType: "group-task", entityId: taskId, title: afterTask.title, operation: "update",
    before: { title: before.title }, after: { title: afterTask.title },
  };
  return makeAction(state, view,
    (s) => projectGroup(s, projectId, () => after),
    (api, callId) => {
      api.updateGroupTask(projectId, afterTask as never);
      return { undo: () => api.updateGroupTask(projectId, before as never) };
    });
}

function prepareAssignGroupTask(toolName: TransactionSafeToolName, input: unknown, state: AppState, fail: Fail): PreparedWriteResult {
  const parsed = safeParse<{ projectId: string; taskId: string; assigneeId: string | null }>(toolName, input);
  if (!parsed.ok) return parsed;
  const { projectId, taskId, assigneeId } = parsed.data;
  const project = state.groupProjects.find((p) => p.id === projectId);
  if (!project) return notFound("未找到对应小组项目。");
  const before = project.tasks.find((t) => t.id === taskId);
  if (!before) return notFound("未找到对应小组任务。");
  if (assigneeId && !project.members.some((m) => m.id === assigneeId)) {
    return notFound("未找到对应成员，不能分配。");
  }
  const afterTask = { ...before, assigneeId: assigneeId ?? undefined };
  const after = { ...project, tasks: project.tasks.map((t) => (t.id === taskId ? afterTask : t)) };
  const view: PreparedActionView = {
    tool: toolName, entityType: "group-task", entityId: taskId, title: before.title, operation: "update",
    before: { assigneeId: before.assigneeId ?? null }, after: { assigneeId },
  };
  return makeAction(state, view,
    (s) => projectGroup(s, projectId, () => after),
    (api, callId) => {
      api.updateGroupTask(projectId, afterTask as never);
      return { undo: () => api.updateGroupTask(projectId, before as never) };
    });
}

function prepareSetGroupTaskDDL(toolName: TransactionSafeToolName, input: unknown, state: AppState, fail: Fail): PreparedWriteResult {
  const parsed = safeParse<{ projectId: string; taskId: string; ddl: string }>(toolName, input);
  if (!parsed.ok) return parsed;
  const { projectId, taskId, ddl } = parsed.data;
  const project = state.groupProjects.find((p) => p.id === projectId);
  if (!project) return notFound("未找到对应小组项目。");
  const before = project.tasks.find((t) => t.id === taskId);
  if (!before) return notFound("未找到对应小组任务。");
  const afterTask = { ...before, ddl };
  const after = { ...project, tasks: project.tasks.map((t) => (t.id === taskId ? afterTask : t)) };
  const view: PreparedActionView = {
    tool: toolName, entityType: "group-task", entityId: taskId, title: before.title, operation: "update",
    before: { ddl: before.ddl }, after: { ddl },
  };
  return makeAction(state, view,
    (s) => projectGroup(s, projectId, () => after),
    (api, callId) => {
      api.updateGroupTask(projectId, afterTask as never);
      return { undo: () => api.updateGroupTask(projectId, before as never) };
    });
}

function prepareToggleGroupTask(toolName: TransactionSafeToolName, input: unknown, state: AppState, fail: Fail): PreparedWriteResult {
  const parsed = safeParse<{ projectId: string; taskId: string }>(toolName, input);
  if (!parsed.ok) return parsed;
  const { projectId, taskId } = parsed.data;
  const project = state.groupProjects.find((p) => p.id === projectId);
  if (!project) return notFound("未找到对应小组项目。");
  const before = project.tasks.find((t) => t.id === taskId);
  if (!before) return notFound("未找到对应小组任务。");
  const afterTask = { ...before, completed: !before.completed };
  const after = { ...project, tasks: project.tasks.map((t) => (t.id === taskId ? afterTask : t)) };
  const view: PreparedActionView = {
    tool: toolName, entityType: "group-task", entityId: taskId, title: before.title, operation: "update",
    before: { completed: before.completed }, after: { completed: afterTask.completed },
  };
  return makeAction(state, view,
    (s) => projectGroup(s, projectId, () => after),
    (api, callId) => {
      api.toggleGroupTask(projectId, taskId);
      return { undo: () => api.toggleGroupTask(projectId, taskId) }; // 再次切换即恢复

    });
}

// ---------- 统一入口 ----------

const PREPARERS: Record<TransactionSafeToolName, (toolName: TransactionSafeToolName, input: unknown, state: AppState, fail: Fail) => PreparedWriteResult> = {
  update_assignment: prepareUpdateAssignment,
  set_assignment_ddl: prepareSetAssignmentDDL,
  set_assignment_priority: prepareSetAssignmentPriority,
  set_assignment_status: prepareSetAssignmentStatus,
  set_assignment_progress: prepareSetAssignmentProgress,
  toggle_assignment_subtask: prepareToggleAssignmentSubtask,
  delete_assignment: prepareDeleteAssignment,
  move_schedule: prepareMoveSchedule,
  resize_schedule: prepareResizeSchedule,
  update_schedule: prepareUpdateSchedule,
  exclude_schedule_week: prepareExcludeScheduleWeek,
  delete_schedule: prepareDeleteSchedule,
  update_course: prepareUpdateCourse,
  update_group_project: prepareUpdateGroupProject,
  update_group_member: prepareUpdateGroupMember,
  update_group_task: prepareUpdateGroupTask,
  assign_group_task: prepareAssignGroupTask,
  set_group_task_ddl: prepareSetGroupTaskDDL,
  toggle_group_task: prepareToggleGroupTask,
};

/** 共享 Write Preflight：对给定 state 校验 + 投影 + commit（Single 与 Transaction 同一规则） */
export function prepareKiroWriteTool(toolName: string, input: unknown, state: AppState): PreparedWriteResult {
  const preparer = PREPARERS[toolName as TransactionSafeToolName];
  if (!preparer) return { ok: false, code: "UNSUPPORTED", message: `该工具不支持事务化执行：${toolName}` };
  return preparer(toolName as TransactionSafeToolName, input, state, () => ({ ok: false, code: "UNKNOWN", message: "" }));
}
