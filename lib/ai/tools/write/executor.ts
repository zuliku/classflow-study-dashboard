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
