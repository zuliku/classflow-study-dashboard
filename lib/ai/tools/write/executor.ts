import {
  CourseSchedule,
  GroupTask,
} from "@/types";
import {
  KiroWriteApi,
  WriteToolResult,
} from "@/lib/ai/tools/write/types";
import { KIRO_WRITE_TOOL_SCHEMAS, KiroWriteToolName } from "@/lib/ai/tools/write/schemas";
import { getDefaultCourseAppearance } from "@/lib/courseAppearance";
import { validateScheduleCandidate, snapMinutes, minutesToTime, getScheduleDuration, clampScheduleMove, MIN_SCHEDULE_DURATION, TIMETABLE_DAY_END_MINUTES } from "@/lib/timetableInteraction";
import { timeToMinutes } from "@/lib/schedule";
import { formatLocalDate } from "@/lib/groupProject";

/**
 * Write Tool Executor：只通过受限 KiroWriteApi 调用现有 ClassFlow Action。
 * 所有写权限来自白名单；禁止 setState / eval / 任意 JS。
 * 每个工具执行前做完整 preflight（schema / entity / reference / 冲突 / leader 规则），
 * 失败时不产生任何 mutation。
 */

const notFound = (message: string): WriteToolResult<never> => ({ ok: false, code: "NOT_FOUND", message });
const invalidInput = (message: string): WriteToolResult<never> => ({ ok: false, code: "INVALID_INPUT", message });
const conflict = (message: string, details?: unknown): WriteToolResult<never> => ({ ok: false, code: "CONFLICT", message, details });

function safeParse<T>(toolName: KiroWriteToolName, input: unknown): { ok: true; data: T } | { ok: false; code: "INVALID_INPUT"; message: string } {
  const parsed = KIRO_WRITE_TOOL_SCHEMAS[toolName].safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, code: "INVALID_INPUT", message: first ? `${first.path.join(".") || "输入"}: ${first.message}` : "输入不合法。" };
  }
  return { ok: true, data: parsed.data as T };
}

function courseName(api: KiroWriteApi, courseId: string): string {
  return api.getState().courses.find((c) => c.id === courseId)?.name ?? "课程";
}

function scheduleTimeText(s: { dayOfWeek: number; startTime: string; endTime: string }): string {
  const dayNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  return `${dayNames[s.dayOfWeek - 1] ?? s.dayOfWeek} ${s.startTime}–${s.endTime}`;
}

/** 排课冲突预检：候选时段与其它排课冲突 → CONFLICT（禁止写入） */
function checkScheduleConflict(
  api: KiroWriteApi,
  candidate: CourseSchedule,
  excludeScheduleId: string
): WriteToolResult<unknown> | null {
  const state = api.getState();
  const validation = validateScheduleCandidate(candidate, state.schedules, excludeScheduleId);
  if (!validation.valid && validation.conflict) {
    const other = validation.conflict.scheduleA.id === candidate.id
      ? validation.conflict.scheduleB
      : validation.conflict.scheduleA;
    const otherCourse = state.courses.find((c) => c.id === other.courseId);
    return conflict(
      `${scheduleTimeText(candidate)} 与《${otherCourse?.name ?? "另一门课"}》时间冲突，因此没有修改。`,
      {
        conflictingCourse: otherCourse?.name ?? null,
        dayOfWeek: validation.conflict.dayOfWeek,
        startTime: other.startTime,
        endTime: other.endTime,
      }
    );
  }
  return null;
}

/** 校验 HH:mm 且 end > start */
function validTimeRange(start: string, end: string): boolean {
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  return s !== null && e !== null && e > s;
}

// ---------- Assignment ----------

function createAssignment(api: KiroWriteApi, input: unknown, toolCallId: string): WriteToolResult<unknown> {
  const parsed = safeParse<{ courseId: string; title: string; description?: string; ddl: string; priority?: string; status?: string; progress?: number; tags?: string[] }>("create_assignment", input);
  if (!parsed.ok) return parsed;
  const { courseId, title, description, ddl, priority, status, progress, tags } = parsed.data;
  if (!api.getState().courses.some((c) => c.id === courseId)) return notFound("未找到对应课程。");

  const prefs = api.getState().preferences;
  const id = api.addAssignment({
    courseId,
    title,
    description: description ?? "",
    ddl,
    priority: (priority ?? prefs.defaultTaskPriority) as never,
    status: (status ?? prefs.defaultTaskStatus) as never,
    progress: progress ?? 0,
    tags: tags ?? [],
  });

  api.registerUndo(toolCallId, () => {
    api.deleteAssignment(id);
  });

  return {
    ok: true,
    data: { id },
    action: {
      tool: "create_assignment",
      entityType: "assignment",
      entityId: id,
      title,
      operation: "create",
      after: { ddl, priority: priority ?? prefs.defaultTaskPriority, status: status ?? prefs.defaultTaskStatus },
      canUndo: true,
    },
  };
}

function updateAssignment(api: KiroWriteApi, input: unknown, toolCallId: string): WriteToolResult<unknown> {
  const parsed = safeParse<{ assignmentId: string; title?: string; description?: string; tags?: string[] }>("update_assignment", input);
  if (!parsed.ok) return parsed;
  const { assignmentId, title, description, tags } = parsed.data;
  const before = api.getState().assignments.find((a) => a.id === assignmentId);
  if (!before) return notFound("未找到对应任务。");

  const after = {
    ...before,
    title: title ?? before.title,
    description: description !== undefined ? description : before.description,
    tags: tags ?? before.tags,
  };
  api.updateAssignment(after);
  api.registerUndo(toolCallId, () => api.updateAssignment(before));

  return {
    ok: true,
    data: { id: assignmentId },
    action: { tool: "update_assignment", entityType: "assignment", entityId: assignmentId, title: after.title, operation: "update", before: { title: before.title, description: before.description, tags: before.tags }, after: { title: after.title, description: after.description, tags: after.tags }, canUndo: true },
  };
}

function setAssignmentDDL(api: KiroWriteApi, input: unknown, toolCallId: string): WriteToolResult<unknown> {
  const parsed = safeParse<{ assignmentId: string; ddl: string }>("set_assignment_ddl", input);
  if (!parsed.ok) return parsed;
  const { assignmentId, ddl } = parsed.data;
  const before = api.getState().assignments.find((a) => a.id === assignmentId);
  if (!before) return notFound("未找到对应任务。");

  api.updateAssignment({ ...before, ddl }); // CalendarMark 由 store 自动同步
  api.registerUndo(toolCallId, () => api.updateAssignment(before));

  return {
    ok: true,
    data: { id: assignmentId },
    action: {
      tool: "set_assignment_ddl",
      entityType: "assignment",
      entityId: assignmentId,
      title: before.title,
      operation: "update",
      before: { ddl: before.ddl },
      after: { ddl },
      canUndo: true,
    },
  };
}

function setAssignmentPriority(api: KiroWriteApi, input: unknown, toolCallId: string): WriteToolResult<unknown> {
  const parsed = safeParse<{ assignmentId: string; priority: string }>("set_assignment_priority", input);
  if (!parsed.ok) return parsed;
  const { assignmentId, priority } = parsed.data;
  const before = api.getState().assignments.find((a) => a.id === assignmentId);
  if (!before) return notFound("未找到对应任务。");

  api.updateAssignmentPriority(assignmentId, priority as never);
  api.registerUndo(toolCallId, () => api.updateAssignment(before));

  return {
    ok: true,
    data: { id: assignmentId },
    action: {
      tool: "set_assignment_priority",
      entityType: "assignment",
      entityId: assignmentId,
      title: before.title,
      operation: "update",
      before: { priority: before.priority },
      after: { priority },
      canUndo: true,
    },
  };
}

function setAssignmentStatus(api: KiroWriteApi, input: unknown, toolCallId: string): WriteToolResult<unknown> {
  const parsed = safeParse<{ assignmentId: string; status: string }>("set_assignment_status", input);
  if (!parsed.ok) return parsed;
  const { assignmentId, status } = parsed.data;
  const before = api.getState().assignments.find((a) => a.id === assignmentId);
  if (!before) return notFound("未找到对应任务。");

  api.updateAssignmentStatus(assignmentId, status as never); // 保留 completed → progress 100 语义
  api.registerUndo(toolCallId, () => api.updateAssignment(before));

  return {
    ok: true,
    data: { id: assignmentId },
    action: {
      tool: "set_assignment_status",
      entityType: "assignment",
      entityId: assignmentId,
      title: before.title,
      operation: "update",
      before: { status: before.status },
      after: { status },
      canUndo: true,
    },
  };
}

function setAssignmentProgress(api: KiroWriteApi, input: unknown, toolCallId: string): WriteToolResult<unknown> {
  const parsed = safeParse<{ assignmentId: string; progress: number }>("set_assignment_progress", input);
  if (!parsed.ok) return parsed;
  const { assignmentId, progress } = parsed.data;
  const before = api.getState().assignments.find((a) => a.id === assignmentId);
  if (!before) return notFound("未找到对应任务。");

  api.updateAssignmentProgress(assignmentId, progress); // status 由 store 自动同步
  api.registerUndo(toolCallId, () => api.updateAssignment(before));

  return {
    ok: true,
    data: { id: assignmentId },
    action: {
      tool: "set_assignment_progress",
      entityType: "assignment",
      entityId: assignmentId,
      title: before.title,
      operation: "update",
      before: { progress: before.progress },
      after: { progress },
      canUndo: true,
    },
  };
}

function toggleAssignmentSubtask(api: KiroWriteApi, input: unknown, toolCallId: string): WriteToolResult<unknown> {
  const parsed = safeParse<{ assignmentId: string; subtaskId: string }>("toggle_assignment_subtask", input);
  if (!parsed.ok) return parsed;
  const { assignmentId, subtaskId } = parsed.data;
  const before = api.getState().assignments.find((a) => a.id === assignmentId);
  if (!before) return notFound("未找到对应任务。");
  if (!before.subtasks?.some((st) => st.id === subtaskId)) return notFound("未找到对应子任务。");

  api.toggleSubtask(assignmentId, subtaskId);
  api.registerUndo(toolCallId, () => api.toggleSubtask(assignmentId, subtaskId)); // 再次切换即恢复

  return {
    ok: true,
    data: { id: assignmentId },
    action: {
      tool: "toggle_assignment_subtask",
      entityType: "assignment",
      entityId: assignmentId,
      title: before.title,
      operation: "update",
      before: { subtaskId, completed: before.subtasks.find((st) => st.id === subtaskId)?.completed },
      canUndo: true,
    },
  };
}

function deleteAssignment(api: KiroWriteApi, input: unknown, toolCallId: string): WriteToolResult<unknown> {
  const parsed = safeParse<{ assignmentId: string }>("delete_assignment", input);
  if (!parsed.ok) return parsed;
  const { assignmentId } = parsed.data;
  const before = api.getState().assignments.find((a) => a.id === assignmentId);
  if (!before) return notFound("未找到对应任务。");

  const removed = api.deleteAssignment(assignmentId);
  if (!removed) return { ok: false, code: "EXECUTION_FAILED", message: "删除任务失败。" };

  api.registerUndo(toolCallId, () => api.restoreAssignment(removed.assignment, removed.marks));

  return {
    ok: true,
    data: { id: assignmentId },
    action: {
      tool: "delete_assignment",
      entityType: "assignment",
      entityId: assignmentId,
      title: before.title,
      operation: "delete",
      before: { title: before.title, ddl: before.ddl },
      canUndo: true,
    },
  };
}

// ---------- Schedule ----------

function createSchedule(api: KiroWriteApi, input: unknown, toolCallId: string): WriteToolResult<unknown> {
  const parsed = safeParse<{ courseId: string; dayOfWeek: number; startTime: string; endTime: string; location?: string; weeks?: string }>("create_schedule", input);
  if (!parsed.ok) return parsed;
  const { courseId, dayOfWeek, startTime, endTime, location, weeks } = parsed.data;
  if (!api.getState().courses.some((c) => c.id === courseId)) return notFound("未找到对应课程。");
  if (!validTimeRange(startTime, endTime)) return invalidInput("结束时间必须晚于开始时间。");

  const candidate: CourseSchedule = {
    id: "tmp-new",
    courseId,
    dayOfWeek,
    startTime,
    endTime,
    location: location ?? "",
    weeks: weeks ?? "1-16周",
  };
  const conflictResult = checkScheduleConflict(api, candidate, "tmp-new");
  if (conflictResult) return conflictResult;

  const id = api.addScheduleSlot(candidate);
  api.registerUndo(toolCallId, () => {
    api.deleteSchedule(id);
  });

  return {
    ok: true,
    data: { id },
    action: {
      tool: "create_schedule",
      entityType: "schedule",
      entityId: id,
      title: courseName(api, courseId),
      operation: "create",
      after: { dayOfWeek, startTime, endTime, location, weeks },
      canUndo: true,
    },
  };
}

function moveSchedule(api: KiroWriteApi, input: unknown, toolCallId: string): WriteToolResult<unknown> {
  const parsed = safeParse<{ scheduleId: string; dayOfWeek: number; startTime: string }>("move_schedule", input);
  if (!parsed.ok) return parsed;
  const { scheduleId, dayOfWeek, startTime } = parsed.data;
  const before = api.getState().schedules.find((s) => s.id === scheduleId);
  if (!before) return notFound("未找到对应排课。");

  const start = clampScheduleMove(before, snapMinutes(timeToMinutes(startTime) ?? 480));
  const duration = getScheduleDuration(before);
  const candidate = {
    ...before,
    dayOfWeek,
    startTime: minutesToTime(start),
    endTime: minutesToTime(start + duration),
  };
  const conflictResult = checkScheduleConflict(api, candidate, scheduleId);
  if (conflictResult) return conflictResult;

  api.updateSchedule(candidate);
  api.registerUndo(toolCallId, () => api.updateSchedule(before));

  return {
    ok: true,
    data: { id: scheduleId },
    action: {
      tool: "move_schedule",
      entityType: "schedule",
      entityId: scheduleId,
      title: courseName(api, before.courseId),
      operation: "update",
      before: { dayOfWeek: before.dayOfWeek, startTime: before.startTime, endTime: before.endTime },
      after: { dayOfWeek, startTime: candidate.startTime, endTime: candidate.endTime },
      canUndo: true,
    },
  };
}

function resizeSchedule(api: KiroWriteApi, input: unknown, toolCallId: string): WriteToolResult<unknown> {
  const parsed = safeParse<{ scheduleId: string; endTime: string }>("resize_schedule", input);
  if (!parsed.ok) return parsed;
  const { scheduleId, endTime } = parsed.data;
  const before = api.getState().schedules.find((s) => s.id === scheduleId);
  if (!before) return notFound("未找到对应排课。");

  const start = timeToMinutes(before.startTime) ?? 480;
  let end = snapMinutes(timeToMinutes(endTime) ?? 480);
  const minEnd = start + MIN_SCHEDULE_DURATION;
  end = Math.min(Math.max(end, minEnd), TIMETABLE_DAY_END_MINUTES);
  if (end <= start) end = TIMETABLE_DAY_END_MINUTES;

  const candidate = { ...before, endTime: minutesToTime(end) };
  const conflictResult = checkScheduleConflict(api, candidate, scheduleId);
  if (conflictResult) return conflictResult;

  api.updateSchedule(candidate);
  api.registerUndo(toolCallId, () => api.updateSchedule(before));

  return {
    ok: true,
    data: { id: scheduleId },
    action: {
      tool: "resize_schedule",
      entityType: "schedule",
      entityId: scheduleId,
      title: courseName(api, before.courseId),
      operation: "update",
      before: { startTime: before.startTime, endTime: before.endTime },
      after: { startTime: before.startTime, endTime: candidate.endTime },
      canUndo: true,
    },
  };
}

function updateSchedule(api: KiroWriteApi, input: unknown, toolCallId: string): WriteToolResult<unknown> {
  const parsed = safeParse<{ scheduleId: string; dayOfWeek?: number; startTime?: string; endTime?: string; location?: string; weeks?: string }>("update_schedule", input);
  if (!parsed.ok) return parsed;
  const { scheduleId, ...patch } = parsed.data;
  const before = api.getState().schedules.find((s) => s.id === scheduleId);
  if (!before) return notFound("未找到对应排课。");

  const after = { ...before, ...patch } as typeof before;
  if (after.startTime && after.endTime && !validTimeRange(after.startTime, after.endTime)) {
    return invalidInput("结束时间必须晚于开始时间。");
  }
  // 时间/星期/周次变化 → 冲突预检
  if (patch.dayOfWeek !== undefined || patch.startTime !== undefined || patch.endTime !== undefined || patch.weeks !== undefined) {
    const conflictResult = checkScheduleConflict(api, after, scheduleId);
    if (conflictResult) return conflictResult;
  }

  api.updateSchedule(after);
  api.registerUndo(toolCallId, () => api.updateSchedule(before));

  return {
    ok: true,
    data: { id: scheduleId },
    action: {
      tool: "update_schedule",
      entityType: "schedule",
      entityId: scheduleId,
      title: courseName(api, before.courseId),
      operation: "update",
      before: { dayOfWeek: before.dayOfWeek, startTime: before.startTime, endTime: before.endTime, location: before.location, weeks: before.weeks },
      after: { dayOfWeek: after.dayOfWeek, startTime: after.startTime, endTime: after.endTime, location: after.location, weeks: after.weeks },
      canUndo: true,
    },
  };
}

function excludeScheduleWeek(api: KiroWriteApi, input: unknown, toolCallId: string): WriteToolResult<unknown> {
  const parsed = safeParse<{ scheduleId: string; week: number }>("exclude_schedule_week", input);
  if (!parsed.ok) return parsed;
  const { scheduleId, week } = parsed.data;
  const before = api.getState().schedules.find((s) => s.id === scheduleId);
  if (!before) return notFound("未找到对应排课。");
  if (week < 1 || week > api.getState().semester.totalWeeks) return invalidInput(`教学周 ${week} 超出本学期范围。`);

  api.excludeWeekFromSchedule(scheduleId, week);
  api.registerUndo(toolCallId, () => api.updateSchedule(before));

  return {
    ok: true,
    data: { id: scheduleId },
    action: {
      tool: "exclude_schedule_week",
      entityType: "schedule",
      entityId: scheduleId,
      title: courseName(api, before.courseId),
      operation: "update",
      before: { excludedWeeks: before.excludedWeeks ?? [] },
      after: { excludedWeeks: [...(before.excludedWeeks ?? []), week] },
      canUndo: true,
    },
  };
}

function deleteSchedule(api: KiroWriteApi, input: unknown, toolCallId: string): WriteToolResult<unknown> {
  const parsed = safeParse<{ scheduleId: string }>("delete_schedule", input);
  if (!parsed.ok) return parsed;
  const { scheduleId } = parsed.data;
  const before = api.getState().schedules.find((s) => s.id === scheduleId);
  if (!before) return notFound("未找到对应排课。");

  const removed = api.deleteSchedule(scheduleId);
  if (!removed) return { ok: false, code: "EXECUTION_FAILED", message: "删除排课失败。" };
  api.registerUndo(toolCallId, () => api.restoreSchedule(removed));

  return {
    ok: true,
    data: { id: scheduleId },
    action: {
      tool: "delete_schedule",
      entityType: "schedule",
      entityId: scheduleId,
      title: courseName(api, before.courseId),
      operation: "delete",
      before: { dayOfWeek: before.dayOfWeek, startTime: before.startTime, endTime: before.endTime },
      canUndo: true,
    },
  };
}

// ---------- Course ----------

function createCourse(api: KiroWriteApi, input: unknown, toolCallId: string): WriteToolResult<unknown> {
  const parsed = safeParse<{ name: string; code?: string; teacher?: string; classroom?: string; credit?: number; description?: string }>("create_course", input);
  if (!parsed.ok) return parsed;
  const { name, code, teacher, classroom, credit, description } = parsed.data;
  const appearance = getDefaultCourseAppearance();

  const id = api.addCourseWithSchedule(
    {
      name,
      code: code ?? "",
      teacher: teacher ?? "",
      classroom: classroom ?? "",
      credit: credit ?? 0,
      bgHex: appearance.bgHex,
      borderHex: appearance.borderHex,
      textHex: appearance.textHex,
      description: description ?? "",
    },
    []
  );

  // V1：删除整个 Course 属高破坏性级联操作，AI Undo 不开放
  return {
    ok: true,
    data: { id },
    action: {
      tool: "create_course",
      entityType: "course",
      entityId: id,
      title: name,
      operation: "create",
      after: { name, code, teacher, classroom, credit },
      canUndo: false,
    },
  };
}

function updateCourse(api: KiroWriteApi, input: unknown, toolCallId: string): WriteToolResult<unknown> {
  const parsed = safeParse<{ courseId: string; name?: string; code?: string; teacher?: string; classroom?: string; credit?: number; description?: string }>("update_course", input);
  if (!parsed.ok) return parsed;
  const { courseId, ...patch } = parsed.data;
  const before = api.getState().courses.find((c) => c.id === courseId);
  if (!before) return notFound("未找到对应课程。");

  const after = { ...before, ...patch };
  api.updateCourse(after);
  api.registerUndo(toolCallId, () => api.updateCourse(before));

  return {
    ok: true,
    data: { id: courseId },
    action: {
      tool: "update_course",
      entityType: "course",
      entityId: courseId,
      title: after.name,
      operation: "update",
      before: { name: before.name, code: before.code, teacher: before.teacher, classroom: before.classroom, credit: before.credit, description: before.description },
      after: { name: after.name, code: after.code, teacher: after.teacher, classroom: after.classroom, credit: after.credit, description: after.description },
      canUndo: true,
    },
  };
}

// ---------- Group ----------

function createGroupProject(api: KiroWriteApi, input: unknown, toolCallId: string): WriteToolResult<unknown> {
  const parsed = safeParse<{ courseId: string; title: string; description?: string }>("create_group_project", input);
  if (!parsed.ok) return parsed;
  const { courseId, title, description } = parsed.data;
  if (!api.getState().courses.some((c) => c.id === courseId)) return notFound("未找到对应课程。");

  const id = api.addGroupProject({ courseId, title, description });
  api.registerUndo(toolCallId, () => api.deleteGroupProject(id));

  return {
    ok: true,
    data: { id },
    action: {
      tool: "create_group_project",
      entityType: "group-project",
      entityId: id,
      title,
      operation: "create",
      after: { courseId, title, description },
      canUndo: true,
    },
  };
}

function updateGroupProject(api: KiroWriteApi, input: unknown, toolCallId: string): WriteToolResult<unknown> {
  const parsed = safeParse<{ projectId: string; title?: string; description?: string }>("update_group_project", input);
  if (!parsed.ok) return parsed;
  const { projectId, title, description } = parsed.data;
  const before = api.getState().groupProjects.find((p) => p.id === projectId);
  if (!before) return notFound("未找到对应小组项目。");

  api.updateGroupProject(projectId, { title, description });
  api.registerUndo(toolCallId, () =>
    api.updateGroupProject(projectId, { title: before.title, description: before.description })
  );

  return {
    ok: true,
    data: { id: projectId },
    action: {
      tool: "update_group_project",
      entityType: "group-project",
      entityId: projectId,
      title: title ?? before.title,
      operation: "update",
      before: { title: before.title, description: before.description },
      after: { title: title ?? before.title, description: description ?? before.description },
      canUndo: true,
    },
  };
}

function addGroupMember(api: KiroWriteApi, input: unknown, toolCallId: string): WriteToolResult<unknown> {
  const parsed = safeParse<{ projectId: string; name: string; role?: string; major?: string }>("add_group_member", input);
  if (!parsed.ok) return parsed;
  const { projectId, name, role, major } = parsed.data;
  if (!api.getState().groupProjects.some((p) => p.id === projectId)) return notFound("未找到对应小组项目。");

  const id = api.addGroupMember(projectId, { name, role: role as never, major });
  api.registerUndo(toolCallId, () => {
    api.deleteGroupMember(projectId, id);
  });

  return {
    ok: true,
    data: { id },
    action: {
      tool: "add_group_member",
      entityType: "group-member",
      entityId: id,
      title: name,
      operation: "create",
      after: { name, role: role ?? "member", major },
      canUndo: true,
    },
  };
}

function updateGroupMember(api: KiroWriteApi, input: unknown, toolCallId: string): WriteToolResult<unknown> {
  const parsed = safeParse<{ projectId: string; memberId: string; name?: string; role?: string; major?: string }>("update_group_member", input);
  if (!parsed.ok) return parsed;
  const { projectId, memberId, name, role, major } = parsed.data;
  const project = api.getState().groupProjects.find((p) => p.id === projectId);
  if (!project) return notFound("未找到对应小组项目。");
  const before = project.members.find((m) => m.id === memberId);
  if (!before) return notFound("未找到对应成员。");

  // Leader 规则：禁止降级最后一个 leader
  if (role === "member" && before.role === "leader") {
    const leaderCount = project.members.filter((m) => m.role === "leader").length;
    if (leaderCount <= 1) {
      return { ok: false, code: "LAST_LEADER", message: "该成员是项目中唯一的负责人，不能降级。" };
    }
  }

  const after = { ...before, name: name ?? before.name, role: (role as never) ?? before.role, major: major !== undefined ? major : before.major };
  api.updateGroupMember(projectId, after);
  api.registerUndo(toolCallId, () => api.updateGroupMember(projectId, before));

  return {
    ok: true,
    data: { id: memberId },
    action: {
      tool: "update_group_member",
      entityType: "group-member",
      entityId: memberId,
      title: after.name,
      operation: "update",
      before: { name: before.name, role: before.role, major: before.major },
      after: { name: after.name, role: after.role, major: after.major },
      canUndo: true,
    },
  };
}

function createGroupTask(api: KiroWriteApi, input: unknown, toolCallId: string): WriteToolResult<unknown> {
  const parsed = safeParse<{ projectId: string; title: string; ddl: string; assigneeId?: string | null }>("create_group_task", input);
  if (!parsed.ok) return parsed;
  const { projectId, title, ddl, assigneeId } = parsed.data;
  const project = api.getState().groupProjects.find((p) => p.id === projectId);
  if (!project) return notFound("未找到对应小组项目。");
  if (assigneeId && !project.members.some((m) => m.id === assigneeId)) {
    return notFound("未找到对应成员，不能分配。");
  }

  const id = api.addGroupTask(projectId, { title, ddl, assigneeId: assigneeId ?? undefined });
  api.registerUndo(toolCallId, () => api.deleteGroupTask(projectId, id));

  return {
    ok: true,
    data: { id },
    action: {
      tool: "create_group_task",
      entityType: "group-task",
      entityId: id,
      title,
      operation: "create",
      after: { title, ddl, assigneeId: assigneeId ?? null },
      canUndo: true,
    },
  };
}

function updateGroupTask(api: KiroWriteApi, input: unknown, toolCallId: string): WriteToolResult<unknown> {
  const parsed = safeParse<{ projectId: string; taskId: string; title?: string }>("update_group_task", input);
  if (!parsed.ok) return parsed;
  const { projectId, taskId, title } = parsed.data;
  const project = api.getState().groupProjects.find((p) => p.id === projectId);
  if (!project) return notFound("未找到对应小组项目。");
  const before = project.tasks.find((t) => t.id === taskId);
  if (!before) return notFound("未找到对应小组任务。");

  const after = { ...before, title: title ?? before.title };
  api.updateGroupTask(projectId, after);
  api.registerUndo(toolCallId, () => api.updateGroupTask(projectId, before));

  return {
    ok: true,
    data: { id: taskId },
    action: {
      tool: "update_group_task",
      entityType: "group-task",
      entityId: taskId,
      title: after.title,
      operation: "update",
      before: { title: before.title },
      after: { title: after.title },
      canUndo: true,
    },
  };
}

function assignGroupTask(api: KiroWriteApi, input: unknown, toolCallId: string): WriteToolResult<unknown> {
  const parsed = safeParse<{ projectId: string; taskId: string; assigneeId: string | null }>("assign_group_task", input);
  if (!parsed.ok) return parsed;
  const { projectId, taskId, assigneeId } = parsed.data;
  const project = api.getState().groupProjects.find((p) => p.id === projectId);
  if (!project) return notFound("未找到对应小组项目。");
  const before = project.tasks.find((t) => t.id === taskId);
  if (!before) return notFound("未找到对应小组任务。");
  if (assigneeId && !project.members.some((m) => m.id === assigneeId)) {
    return notFound("未找到对应成员，不能分配。");
  }

  const after = { ...before, assigneeId: assigneeId ?? undefined };
  api.updateGroupTask(projectId, after);
  api.registerUndo(toolCallId, () => api.updateGroupTask(projectId, before));

  return {
    ok: true,
    data: { id: taskId },
    action: {
      tool: "assign_group_task",
      entityType: "group-task",
      entityId: taskId,
      title: before.title,
      operation: "update",
      before: { assigneeId: before.assigneeId ?? null },
      after: { assigneeId },
      canUndo: true,
    },
  };
}

function setGroupTaskDDL(api: KiroWriteApi, input: unknown, toolCallId: string): WriteToolResult<unknown> {
  const parsed = safeParse<{ projectId: string; taskId: string; ddl: string }>("set_group_task_ddl", input);
  if (!parsed.ok) return parsed;
  const { projectId, taskId, ddl } = parsed.data;
  const project = api.getState().groupProjects.find((p) => p.id === projectId);
  if (!project) return notFound("未找到对应小组项目。");
  const before = project.tasks.find((t) => t.id === taskId);
  if (!before) return notFound("未找到对应小组任务。");

  const after = { ...before, ddl };
  api.updateGroupTask(projectId, after); // 本地 wall-clock 原样保存，不做时区转换
  api.registerUndo(toolCallId, () => api.updateGroupTask(projectId, before));

  return {
    ok: true,
    data: { id: taskId },
    action: {
      tool: "set_group_task_ddl",
      entityType: "group-task",
      entityId: taskId,
      title: before.title,
      operation: "update",
      before: { ddl: before.ddl },
      after: { ddl },
      canUndo: true,
    },
  };
}

function toggleGroupTask(api: KiroWriteApi, input: unknown, toolCallId: string): WriteToolResult<unknown> {
  const parsed = safeParse<{ projectId: string; taskId: string }>("toggle_group_task", input);
  if (!parsed.ok) return parsed;
  const { projectId, taskId } = parsed.data;
  const project = api.getState().groupProjects.find((p) => p.id === projectId);
  if (!project) return notFound("未找到对应小组项目。");
  const before = project.tasks.find((t) => t.id === taskId);
  if (!before) return notFound("未找到对应小组任务。");

  api.toggleGroupTask(projectId, taskId);
  api.registerUndo(toolCallId, () => api.toggleGroupTask(projectId, taskId)); // 再次切换即恢复

  return {
    ok: true,
    data: { id: taskId },
    action: {
      tool: "toggle_group_task",
      entityType: "group-task",
      entityId: taskId,
      title: before.title,
      operation: "update",
      before: { completed: before.completed },
      after: { completed: !before.completed },
      canUndo: true,
    },
  };
}

// ---------- 统一入口 ----------

const EXECUTORS: Record<KiroWriteToolName, (api: KiroWriteApi, input: unknown, toolCallId: string) => WriteToolResult<unknown>> = {
  create_assignment: createAssignment,
  update_assignment: updateAssignment,
  set_assignment_ddl: setAssignmentDDL,
  set_assignment_priority: setAssignmentPriority,
  set_assignment_status: setAssignmentStatus,
  set_assignment_progress: setAssignmentProgress,
  toggle_assignment_subtask: toggleAssignmentSubtask,
  delete_assignment: deleteAssignment,
  create_schedule: createSchedule,
  move_schedule: moveSchedule,
  resize_schedule: resizeSchedule,
  update_schedule: updateSchedule,
  exclude_schedule_week: excludeScheduleWeek,
  delete_schedule: deleteSchedule,
  create_course: createCourse,
  update_course: updateCourse,
  create_group_project: createGroupProject,
  update_group_project: updateGroupProject,
  add_group_member: addGroupMember,
  update_group_member: updateGroupMember,
  create_group_task: createGroupTask,
  update_group_task: updateGroupTask,
  assign_group_task: assignGroupTask,
  set_group_task_ddl: setGroupTaskDDL,
  toggle_group_task: toggleGroupTask,
};

/**
 * Write Executor：唯一执行入口。
 * 只通过受限 KiroWriteApi 调用白名单 action；preflight 失败不产生 mutation。
 */
export function executeKiroWriteTool(
  toolName: string,
  input: unknown,
  api: KiroWriteApi,
  toolCallId: string
): WriteToolResult<unknown> {
  const executor = EXECUTORS[toolName as KiroWriteToolName];
  if (!executor) {
    return { ok: false, code: "UNSUPPORTED", message: `未知工具：${toolName}` };
  }
  return executor(api, input, toolCallId);
}

export { formatLocalDate };
