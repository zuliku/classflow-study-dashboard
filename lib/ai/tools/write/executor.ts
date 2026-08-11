import {
  CourseSchedule,
  GroupTask,
  Reminder,
  ReminderTargetType,
  ReminderTimingMode,
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
import { parseLocalDDL } from "@/lib/ddl";
import { formatLocalDateTime, getReminderTargetAnchor, resolveReminderTriggerAt } from "@/lib/reminders/reminderDomain";
import { prepareKiroWriteTool } from "@/lib/ai/tools/write/prepare";
import { TransactionSafeToolName } from "@/lib/ai/transactions/types";

/**
 * Write Tool Executor：只通过受限 KiroWriteApi 调用现有 ClassFlow Action。
 * 所有写权限来自白名单；禁止 setState / eval / 任意 JS。
 * 事务安全工具（已有实体操作）统一走 prepareKiroWriteTool（与 Change Set 共享同一套 domain validation）；
 * create_*（动态 ID 依赖）保持独立执行路径。
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

// ---------- Create（动态 ID 依赖，保持独立执行路径；不进入 Transaction V1） ----------

function createAssignment(api: KiroWriteApi, input: unknown, toolCallId: string): WriteToolResult<unknown> {
  const parsed = safeParse<{ courseId: string; title: string; description?: string; ddl?: string; estimatedMinutes?: number; priority?: string; status?: string; progress?: number; tags?: string[] }>("create_assignment", input);
  if (!parsed.ok) return parsed;
  const { courseId, title, description, ddl, estimatedMinutes, priority, status, progress, tags } = parsed.data;
  if (!api.getState().courses.some((c) => c.id === courseId)) return notFound("未找到对应课程。");

  const prefs = api.getState().preferences;
  const id = api.addAssignment({
    courseId,
    title,
    description: description ?? "",
    // Task V2：DDL 可选（缺省 = 无截止时间，Store 不创建空 mark）；estimatedMinutes 由 store normalize 清洗
    ddl,
    estimatedMinutes,
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
      after: { ddl: ddl ?? null, estimatedMinutes: estimatedMinutes ?? null, priority: priority ?? prefs.defaultTaskPriority, status: status ?? prefs.defaultTaskStatus },
      canUndo: true,
    },
  };
}

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

function createGroupMember(api: KiroWriteApi, input: unknown, toolCallId: string): WriteToolResult<unknown> {
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

// ---------- 事务安全工具：委托 prepareKiroWriteTool（与 Change Set 共享同一套 domain validation） ----------

function viaPrepare(toolName: TransactionSafeToolName) {
  return (api: KiroWriteApi, input: unknown, toolCallId: string): WriteToolResult<unknown> => {
    const prep = prepareKiroWriteTool(toolName, input, api.getState());
    if (!prep.ok) return prep as WriteToolResult<unknown>;
    try {
      const r = prep.commit(api, toolCallId);
      if (r === null) return { ok: false, code: "EXECUTION_FAILED", message: "操作执行失败。" };
      if (r.undo) api.registerUndo(toolCallId, r.undo);
    } catch {
      return { ok: false, code: "EXECUTION_FAILED", message: "操作执行失败。" };
    }
    return {
      ok: true,
      data: { id: prep.view.entityId },
      action: {
        tool: prep.view.tool,
        entityType: prep.view.entityType,
        entityId: prep.view.entityId,
        title: prep.view.title,
        operation: prep.view.operation,
        before: prep.view.before,
        after: prep.view.after,
        canUndo: true,
      },
    };
  };
}
// ---------- Task 7G-B：Reminder 写工具（独立路径，不进 Change Set V1） ----------

/** Reminder duplicate guard（Kiro 层与 UI 一致）：relative 同 offset / absolute 同 triggerAt；跨模式不算重复 */
function hasKiroReminderDuplicate(
  api: KiroWriteApi,
  input: {
    targetType: ReminderTargetType;
    targetId?: string;
    timingMode: ReminderTimingMode;
    offsetMinutes?: number;
    triggerAt: string;
  },
  excludeReminderId?: string
): boolean {
  return api.getState().reminders.some((r) => {
    if (r.targetType !== input.targetType || r.targetId !== input.targetId) return false;
    if (r.status !== "scheduled" || r.id === excludeReminderId) return false;
    if (input.timingMode === "relative" && r.timingMode === "relative") {
      return (r.offsetMinutes ?? 0) === (input.offsetMinutes ?? 0);
    }
    if (input.timingMode === "absolute" && r.timingMode === "absolute") {
      return r.triggerAt === input.triggerAt;
    }
    return false;
  });
}

/** target 校验 + anchor（relative 必须；absolute 附带 target 存在性校验） */
function resolveReminderTarget(
  api: KiroWriteApi,
  targetType: ReminderTargetType,
  targetId: string | undefined
): { anchor: string | null; notFound: boolean; completedAssignment: boolean } {
  const state = api.getState();
  if (targetType === "assignment") {
    const a = state.assignments.find((x) => x.id === targetId);
    if (!a) return { anchor: null, notFound: true, completedAssignment: false };
    return {
      anchor: getReminderTargetAnchor("assignment", a),
      notFound: false,
      completedAssignment: a.status === "completed",
    };
  }
  if (targetType === "studyBlock") {
    const b = state.studyBlocks.find((x) => x.id === targetId);
    if (!b) return { anchor: null, notFound: true, completedAssignment: false };
    return { anchor: getReminderTargetAnchor("studyBlock", b), notFound: false, completedAssignment: false };
  }
  if (targetType === "calendarMark") {
    const m = state.calendarMarks.find((x) => x.id === targetId);
    if (!m) return { anchor: null, notFound: true, completedAssignment: false };
    return { anchor: getReminderTargetAnchor("calendarMark", m), notFound: false, completedAssignment: false };
  }
  return { anchor: null, notFound: false, completedAssignment: false };
}

function createReminder(api: KiroWriteApi, input: unknown, toolCallId: string): WriteToolResult<unknown> {
  const parsed = safeParse<
    | { title: string; note?: string; targetType: "assignment" | "studyBlock" | "calendarMark"; targetId: string; timingMode: "relative"; offsetMinutes: number }
    | { title: string; note?: string; timingMode: "absolute"; triggerAt: string; targetType?: ReminderTargetType; targetId?: string }
  >("create_reminder", input);
  if (!parsed.ok) return parsed;
  const nowMs = new Date().getTime();

  if (parsed.data.timingMode === "relative") {
    const { title, note, targetType, targetId, offsetMinutes } = parsed.data;
    const target = resolveReminderTarget(api, targetType, targetId);
    if (target.notFound) return notFound("未找到对应目标。");
    if (target.completedAssignment) return invalidInput("已完成任务无需新增相对提醒。");
    if (!target.anchor) return invalidInput("该目标没有可用的提醒基准时间（如任务缺少截止时间）。");
    const triggerAt = resolveReminderTriggerAt({ timingMode: "relative", triggerAt: target.anchor, offsetMinutes });
    if (!triggerAt || (parseLocalDDL(triggerAt)?.getTime() ?? 0) <= nowMs) {
      return invalidInput("该提醒时间已过，无法创建。");
    }
    if (hasKiroReminderDuplicate(api, { targetType, targetId, timingMode: "relative", offsetMinutes, triggerAt })) {
      return invalidInput("已存在相同的提醒。");
    }
    const id = api.addReminder({ title, note, targetType, targetId, timingMode: "relative", offsetMinutes, triggerAt: target.anchor, source: "kiro" });
    if (id === null) return invalidInput("提醒创建失败。");
    api.registerUndo(toolCallId, () => api.deleteReminder(id));
    return {
      ok: true,
      data: { id },
      action: {
        tool: "create_reminder",
        entityType: "reminder",
        entityId: id,
        title,
        operation: "create",
        after: { timingMode: "relative", offsetMinutes, triggerAt, targetType, targetId },
        canUndo: true,
      },
    };
  }

  const { title, note, triggerAt, targetId } = parsed.data;
  const targetType = parsed.data.targetType ?? "standalone";
  if (targetType === "standalone") {
    if (targetId !== undefined) return invalidInput("独立提醒不需要 targetId。");
  } else {
    if (!targetId) return invalidInput("需要指定目标 ID。");
    const target = resolveReminderTarget(api, targetType, targetId);
    if (target.notFound) return notFound("未找到对应目标。");
  }
  if ((parseLocalDDL(triggerAt)?.getTime() ?? 0) <= nowMs) return invalidInput("提醒时间已过，请选择未来的时间。");
  if (hasKiroReminderDuplicate(api, { targetType, targetId, timingMode: "absolute", triggerAt })) {
    return invalidInput("已存在相同时间的提醒。");
  }
  const id = api.addReminder({ title, note, targetType, targetId: targetType === "standalone" ? undefined : targetId, timingMode: "absolute", triggerAt, source: "kiro" });
  if (id === null) return invalidInput("提醒创建失败。");
  api.registerUndo(toolCallId, () => api.deleteReminder(id));
  return {
    ok: true,
    data: { id },
    action: {
      tool: "create_reminder",
      entityType: "reminder",
      entityId: id,
      title,
      operation: "create",
      after: { timingMode: "absolute", triggerAt, targetType, targetId: targetType === "standalone" ? undefined : targetId },
      canUndo: true,
    },
  };
}

/** 完整快照恢复（update undo 用；reconcile 由调用方决定） */
function restoreReminderSnapshot(api: KiroWriteApi, before: Reminder) {
  api.updateReminder(before.id, {
    title: before.title,
    note: before.note,
    timingMode: before.timingMode,
    offsetMinutes: before.offsetMinutes,
    triggerAt: before.triggerAt,
    status: before.status,
    firedAt: before.firedAt,
    readAt: before.readAt,
    source: before.source,
  });
}

function updateReminder(api: KiroWriteApi, input: unknown, toolCallId: string): WriteToolResult<unknown> {
  const parsed = safeParse<{ reminderId: string; title?: string; note?: string | null; timingMode?: ReminderTimingMode; offsetMinutes?: number; triggerAt?: string }>("update_reminder", input);
  if (!parsed.ok) return parsed;
  const old = api.getState().reminders.find((r) => r.id === parsed.data.reminderId);
  if (!old) return notFound("未找到对应提醒。");
  if (old.status !== "scheduled") return invalidInput("历史提醒不能修改时间重新激活。");

  const nextTimingMode = parsed.data.timingMode ?? old.timingMode;
  const nowMs = new Date().getTime();
  const before: Reminder = { ...old };

  if (nextTimingMode === "relative") {
    if (old.targetType === "standalone") return invalidInput("独立提醒不支持相对时间。");
    const offsetMinutes = parsed.data.offsetMinutes ?? old.offsetMinutes;
    if (offsetMinutes === undefined) return invalidInput("缺少提前时间（offsetMinutes）。");
    const target = resolveReminderTarget(api, old.targetType, old.targetId);
    if (target.notFound) return notFound("提醒的目标已不存在。");
    if (!target.anchor) return invalidInput("目标已没有可用的提醒基准时间。");
    const triggerAt = resolveReminderTriggerAt({ timingMode: "relative", triggerAt: target.anchor, offsetMinutes });
    if (!triggerAt || (parseLocalDDL(triggerAt)?.getTime() ?? 0) <= nowMs) {
      return invalidInput("调整后的提醒时间已过。");
    }
    if (
      hasKiroReminderDuplicate(
        api,
        { targetType: old.targetType, targetId: old.targetId, timingMode: "relative", offsetMinutes, triggerAt },
        old.id
      )
    ) {
      return invalidInput("已存在相同的提醒。");
    }
    api.updateReminder(old.id, {
      title: parsed.data.title ?? old.title,
      note: parsed.data.note !== undefined ? parsed.data.note ?? undefined : old.note,
      timingMode: "relative",
      offsetMinutes,
      triggerAt: target.anchor,
    });
    api.reconcileTargetReminders(old.targetType, old.targetId!);
    const after = api.getState().reminders.find((r) => r.id === old.id)!;
    api.registerUndo(toolCallId, () => {
      restoreReminderSnapshot(api, before);
      if (before.timingMode === "relative") api.reconcileTargetReminders(before.targetType, before.targetId!);
    });
    return {
      ok: true,
      data: { id: old.id },
      action: {
        tool: "update_reminder",
        entityType: "reminder",
        entityId: old.id,
        title: after.title,
        operation: "update",
        before: { timingMode: before.timingMode, offsetMinutes: before.offsetMinutes, triggerAt: before.triggerAt },
        after: { timingMode: after.timingMode, offsetMinutes: after.offsetMinutes, triggerAt: after.triggerAt },
        canUndo: true,
      },
    };
  }

  // absolute
  let triggerAt = parsed.data.triggerAt;
  if (triggerAt === undefined) {
    if (old.timingMode === "absolute") triggerAt = old.triggerAt;
    else return invalidInput("切换为自定义时间时必须提供具体时间（triggerAt）。");
  }
  if ((parseLocalDDL(triggerAt)?.getTime() ?? 0) <= nowMs) return invalidInput("提醒时间已过，请选择未来的时间。");
  if (hasKiroReminderDuplicate(api, { targetType: old.targetType, targetId: old.targetId, timingMode: "absolute", triggerAt }, old.id)) {
    return invalidInput("已存在相同时间的提醒。");
  }
  api.updateReminder(old.id, {
    title: parsed.data.title ?? old.title,
    note: parsed.data.note !== undefined ? parsed.data.note ?? undefined : old.note,
    timingMode: "absolute",
    offsetMinutes: undefined,
    triggerAt,
  });
  // absolute 固定时间：不 reconcile
  const after = api.getState().reminders.find((r) => r.id === old.id)!;
  api.registerUndo(toolCallId, () => {
    restoreReminderSnapshot(api, before);
    if (before.timingMode === "relative") api.reconcileTargetReminders(before.targetType, before.targetId!);
  });
  return {
    ok: true,
    data: { id: old.id },
    action: {
      tool: "update_reminder",
      entityType: "reminder",
      entityId: old.id,
      title: after.title,
      operation: "update",
      before: { timingMode: before.timingMode, offsetMinutes: before.offsetMinutes, triggerAt: before.triggerAt },
      after: { timingMode: "absolute", triggerAt },
      canUndo: true,
    },
  };
}

function deleteReminder(api: KiroWriteApi, input: unknown, toolCallId: string): WriteToolResult<unknown> {
  const parsed = safeParse<{ reminderId: string }>("delete_reminder", input);
  if (!parsed.ok) return parsed;
  const target = api.getState().reminders.find((r) => r.id === parsed.data.reminderId);
  if (!target) return notFound("未找到对应提醒。");
  const snapshot: Reminder = { ...target };
  api.deleteReminder(target.id);
  api.registerUndo(toolCallId, () => api.restoreReminder(snapshot));
  return {
    ok: true,
    data: { id: target.id },
    action: {
      tool: "delete_reminder",
      entityType: "reminder",
      entityId: target.id,
      title: target.title,
      operation: "delete",
      before: { timingMode: target.timingMode, offsetMinutes: target.offsetMinutes, triggerAt: target.triggerAt, targetType: target.targetType },
      canUndo: true,
    },
  };
}

// ---------- Task 5：Focus 工具（有界：canUndo=false，不创建 timer） ----------

function startFocusSession(api: KiroWriteApi, input: unknown, toolCallId: string): WriteToolResult<unknown> {
  const parsed = safeParse<{ plannedMinutes: number; assignmentId?: string; courseId?: string; note?: string }>(
    "start_focus_session",
    input
  );
  if (!parsed.ok) return parsed;
  const result = api.startFocusSession({
    plannedMinutes: parsed.data.plannedMinutes,
    assignmentId: parsed.data.assignmentId,
    courseId: parsed.data.courseId,
    note: parsed.data.note,
    source: "kiro",
  });
  if (!result.ok) return { ok: false, code: result.code, message: focusErrorMessage(result.code) };
  return {
    ok: true,
    data: { id: result.session.id },
    action: {
      tool: "start_focus_session",
      entityType: "focus-session",
      entityId: result.session.id,
      title: result.session.assignmentTitleSnapshot ?? result.session.courseNameSnapshot ?? "专注会话",
      operation: "create",
      after: {
        plannedMinutes: result.session.plannedMinutes,
        assignmentId: result.session.assignmentId ?? null,
        courseId: result.session.courseId ?? null,
        note: result.session.note ?? null,
      },
      canUndo: false,
    },
  };
}

function pauseFocusSession(api: KiroWriteApi, _input: unknown, _toolCallId: string): WriteToolResult<unknown> {
  const result = api.pauseFocusSession();
  if (!result.ok) return { ok: false, code: result.code, message: focusErrorMessage(result.code) };
  return {
    ok: true,
    data: { id: result.session.id },
    action: {
      tool: "pause_focus_session",
      entityType: "focus-session",
      entityId: result.session.id,
      title: result.session.assignmentTitleSnapshot ?? result.session.courseNameSnapshot ?? "专注会话",
      operation: "update",
      after: { status: "paused" },
      canUndo: false,
    },
  };
}

function resumeFocusSession(api: KiroWriteApi, _input: unknown, _toolCallId: string): WriteToolResult<unknown> {
  const result = api.resumeFocusSession();
  if (!result.ok) return { ok: false, code: result.code, message: focusErrorMessage(result.code) };
  return {
    ok: true,
    data: { id: result.session.id },
    action: {
      tool: "resume_focus_session",
      entityType: "focus-session",
      entityId: result.session.id,
      title: result.session.assignmentTitleSnapshot ?? result.session.courseNameSnapshot ?? "专注会话",
      operation: "update",
      after: { status: "running" },
      canUndo: false,
    },
  };
}

function finishFocusSession(api: KiroWriteApi, _input: unknown, _toolCallId: string): WriteToolResult<unknown> {
  const result = api.finishFocusSession();
  if (!result.ok) return { ok: false, code: result.code, message: focusErrorMessage(result.code) };
  return {
    ok: true,
    data: { id: result.session.id },
    action: {
      tool: "finish_focus_session",
      entityType: "focus-session",
      entityId: result.session.id,
      title: result.session.assignmentTitleSnapshot ?? result.session.courseNameSnapshot ?? "专注会话",
      operation: "delete",
      after: { status: "completed", actualActiveMs: result.session.actualActiveMs ?? null },
      canUndo: false,
    },
  };
}

/** Focus Domain 错误 → 用户可读 message（不暴露内部实现） */
function focusErrorMessage(code: string): string {
  const map: Record<string, string> = {
    FOCUS_SESSION_ALREADY_ACTIVE: "已有进行中的专注会话。",
    NO_ACTIVE_FOCUS_SESSION: "当前没有进行中的专注会话。",
    FOCUS_ALREADY_PAUSED: "专注会话已处于暂停状态。",
    FOCUS_NOT_PAUSED: "专注会话未处于暂停状态。",
    INVALID_FOCUS_DURATION: "专注时长需为 1–240 的整数。",
    FOCUS_TARGET_NOT_FOUND: "关联的课程或任务不存在。",
    FOCUS_TARGET_MISMATCH: "任务与课程不匹配。",
  };
  return map[code] ?? "操作失败。";
}

// ---------- 统一入口 ----------

const EXECUTORS: Record<KiroWriteToolName, (api: KiroWriteApi, input: unknown, toolCallId: string) => WriteToolResult<unknown>> = {
  create_assignment: createAssignment,
  update_assignment: viaPrepare("update_assignment"),
  set_assignment_ddl: viaPrepare("set_assignment_ddl"),
  set_assignment_priority: viaPrepare("set_assignment_priority"),
  set_assignment_status: viaPrepare("set_assignment_status"),
  set_assignment_progress: viaPrepare("set_assignment_progress"),
  toggle_assignment_subtask: viaPrepare("toggle_assignment_subtask"),
  delete_assignment: viaPrepare("delete_assignment"),
  create_schedule: createSchedule,
  move_schedule: viaPrepare("move_schedule"),
  resize_schedule: viaPrepare("resize_schedule"),
  update_schedule: viaPrepare("update_schedule"),
  exclude_schedule_week: viaPrepare("exclude_schedule_week"),
  delete_schedule: viaPrepare("delete_schedule"),
  create_course: createCourse,
  update_course: viaPrepare("update_course"),
  create_group_project: createGroupProject,
  update_group_project: viaPrepare("update_group_project"),
  add_group_member: createGroupMember,
  update_group_member: viaPrepare("update_group_member"),
  create_group_task: createGroupTask,
  update_group_task: viaPrepare("update_group_task"),
  assign_group_task: viaPrepare("assign_group_task"),
  set_group_task_ddl: viaPrepare("set_group_task_ddl"),
  toggle_group_task: viaPrepare("toggle_group_task"),
  create_reminder: createReminder,
  update_reminder: updateReminder,
  delete_reminder: deleteReminder,
  start_focus_session: startFocusSession,
  pause_focus_session: pauseFocusSession,
  resume_focus_session: resumeFocusSession,
  finish_focus_session: finishFocusSession,
  apply_change_set: (() => {
    // apply_change_set 不在 EXECUTORS 单写路径执行（走 useKiroChat 事务分支）
    return (): WriteToolResult<never> => ({ ok: false, code: "UNSUPPORTED", message: "请通过事务执行 Change Set。" });
  })(),
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
