import { differenceInDays, isSameWeek, isToday, format } from "date-fns";
import { zhCN } from "date-fns/locale";
import {
  Assignment,
  CalendarMark,
  Course,
  CourseSchedule,
  FocusSession,
  GroupProject,
  Material,
  Reminder,
  StudyBlock,
} from "@/types";
import { parseLocalDDL, getLocalDDLDate, getLocalDDLTime } from "@/lib/ddl";
import { getSemesterWeek, getWeekDateRange } from "@/lib/semester";
import { isScheduleActive, timeToMinutes } from "@/lib/schedule";
import { deriveTaskWorkspace } from "@/lib/tasks/taskViews";
import { deriveAssignmentHealth } from "@/lib/tasks/taskHealth";
import { parseTaskBreakdownProposal } from "@/lib/tasks/taskBreakdown";
import { resolveAssignmentMaterials } from "@/lib/tasks/taskMaterials";
import { deriveFocusClock } from "@/lib/focus/focusDomain";
import { findFreeTime } from "@/lib/planning/freeTime";
import { proposeStudyPlan } from "@/lib/planning/studyPlanner";
import { KIRO_READ_TOOL_SCHEMAS, KiroReadToolName } from "@/lib/ai/tools/read/schemas";

/**
 * Read Tool Executor：pure / deterministic / no mutations。
 * state 每次执行时由调用方传入最新 useAppStore.getState()，绝不缓存旧数据。
 * 工具输出统一 envelope：ok / code / message / candidates。
 */

export type ReadToolErrorCode = "NOT_FOUND" | "INVALID_INPUT" | "AMBIGUOUS" | "OUT_OF_RANGE" | "FILE_MISSING" | "READ_FAILED";

export type ReadToolResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: ReadToolErrorCode;
      message: string;
      candidates?: { id: string; label: string }[];
    };

/** Executor 需要的 Store 最小视图（只读） */
export interface ReadToolState {
  userProfile: {
    name: string;
    college: string;
    grade: string;
    completedCredits: number;
    totalCredits: number;
  };
  semester: { id: string; name: string; startDate: string; totalWeeks: number };
  currentSemesterWeek: number;
  activeTab: string;
  selectedCourseId: string | null;
  selectedAssignmentId: string | null;
  highlightedAssignmentId: string | null;
  courses: Course[];
  schedules: CourseSchedule[];
  assignments: Assignment[];
  calendarMarks: CalendarMark[];
  groupProjects: GroupProject[];
  /** Task V2：学习计划（Kiro 读取 StudyBlock 的唯一来源） */
  studyBlocks: StudyBlock[];
  /** Task 7G-A1：Reminder（optional：旧 fixture 无需改造；执行时回落 []） */
  reminders?: Reminder[];
  /** Task 5：Focus Session（optional：旧 fixture 无需改造；执行时回落 []） */
  focusSessions?: FocusSession[];
}

const notFound = (message: string): ReadToolResult<never> => ({ ok: false, code: "NOT_FOUND", message });
const invalidInput = (message: string): ReadToolResult<never> => ({ ok: false, code: "INVALID_INPUT", message });

function safeParse<T>(toolName: KiroReadToolName, input: unknown): { ok: true; data: T } | { ok: false; code: "INVALID_INPUT"; message: string } {
  const parsed = KIRO_READ_TOOL_SCHEMAS[toolName].safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, code: "INVALID_INPUT", message: first ? `${first.path.join(".") || "输入"}: ${first.message}` : "输入不合法。" };
  }
  return { ok: true, data: parsed.data as T };
}

// ---------- 内部工具 ----------

function courseName(state: ReadToolState, courseId: string): string {
  return state.courses.find((c) => c.id === courseId)?.name ?? "未知课程";
}

function searchCourseCandidates(state: ReadToolState, query?: string): Course[] {
  if (!query) return state.courses;
  const q = query.trim().toLowerCase();
  return state.courses.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.code.toLowerCase().includes(q) ||
      c.teacher.toLowerCase().includes(q)
  );
}

function findAssignment(state: ReadToolState, assignmentId: string): Assignment | null {
  return state.assignments.find((a) => a.id === assignmentId) ?? null;
}

function findCourse(state: ReadToolState, courseId: string): Course | null {
  return state.courses.find((c) => c.id === courseId) ?? null;
}

function findProject(state: ReadToolState, projectId: string): GroupProject | null {
  return state.groupProjects.find((p) => p.id === projectId) ?? null;
}

function materialMeta(m: Material) {
  // 只允许 metadata：id/title/type/size/uploadDate；绝不返回 storageKey / url / Blob
  return { id: m.id, title: m.title, type: m.type, size: m.size ?? null, uploadDate: m.uploadDate };
}

// ---------- 13 个 Read Tool ----------

export function getCurrentContext(state: ReadToolState): ReadToolResult<unknown> {
  const now = new Date();
  return {
    ok: true,
    data: {
      activeTab: state.activeTab,
      currentWeek: state.currentSemesterWeek,
      semesterName: state.semester.name,
      now: format(now, "yyyy-MM-dd HH:mm EEEE", { locale: zhCN }),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "local",
      selectedCourse: state.selectedCourseId
        ? (() => {
            const c = findCourse(state, state.selectedCourseId);
            return c ? { id: c.id, name: c.name, code: c.code } : null;
          })()
        : null,
      selectedAssignment: state.selectedAssignmentId
        ? (() => {
            const a = findAssignment(state, state.selectedAssignmentId);
            return a ? { id: a.id, title: a.title, status: a.status } : null;
          })()
        : null,
    },
  };
}

export function getUserStudyProfile(state: ReadToolState): ReadToolResult<unknown> {
  // 安全字段：不含 studentId / avatarUrl
  const { name, college, grade, completedCredits, totalCredits } = state.userProfile;
  return { ok: true, data: { name, college, grade, completedCredits, totalCredits } };
}

export function searchCourses(state: ReadToolState, input: unknown): ReadToolResult<unknown> {
  const parsed = safeParse<{ query?: string }>("search_courses", input);
  if (!parsed.ok) return parsed;
  const matches = searchCourseCandidates(state, parsed.data.query);
  return {
    ok: true,
    data: matches.map((c) => ({
      id: c.id,
      name: c.name,
      code: c.code,
      teacher: c.teacher,
      classroom: c.classroom,
      credit: c.credit,
    })),
  };
}

export function getCourse(state: ReadToolState, input: unknown): ReadToolResult<unknown> {
  const parsed = safeParse<{ courseId: string }>("get_course", input);
  if (!parsed.ok) return parsed;
  const course = findCourse(state, parsed.data.courseId);
  if (!course) return notFound("未找到对应课程。");

  const schedules = state.schedules
    .filter((s) => s.courseId === course.id)
    .map((s) => ({
      scheduleId: s.id,
      dayOfWeek: s.dayOfWeek,
      startTime: s.startTime,
      endTime: s.endTime,
      location: s.location,
      weeks: s.weeks,
    }));

  return {
    ok: true,
    data: {
      id: course.id,
      name: course.name,
      code: course.code,
      teacher: course.teacher,
      classroom: course.classroom,
      credit: course.credit,
      description: course.description,
      scheduleSummary: schedules,
      materials: course.materials.map(materialMeta),
    },
  };
}

export function getWeekSchedule(state: ReadToolState, input: unknown): ReadToolResult<unknown> {
  const parsed = safeParse<{ week?: number; courseId?: string }>("get_week_schedule", input);
  if (!parsed.ok) return parsed;
  const week = parsed.data.week ?? state.currentSemesterWeek;
  if (week < 1 || week > state.semester.totalWeeks) {
    return { ok: false, code: "OUT_OF_RANGE", message: `教学周 ${week} 超出本学期范围（1-${state.semester.totalWeeks}）。` };
  }

  const weekStart = getWeekDateRange(state.semester, week)[0];
  const isInSemester = week >= 1 && week <= state.semester.totalWeeks;
  const activeSchedules = isInSemester
    ? state.schedules
        .filter(
          (s) =>
            (parsed.data.courseId ? s.courseId === parsed.data.courseId : true) &&
            isScheduleActive(s, week)
        )
        .sort((a, b) => a.dayOfWeek - b.dayOfWeek || (timeToMinutes(a.startTime) ?? 0) - (timeToMinutes(b.startTime) ?? 0))
    : [];

  return {
    ok: true,
    data: {
      week,
      weekStartDate: format(weekStart, "yyyy-MM-dd"),
      entries: activeSchedules.map((s) => ({
        scheduleId: s.id,
        courseId: s.courseId,
        courseName: courseName(state, s.courseId),
        dayOfWeek: s.dayOfWeek,
        startTime: s.startTime,
        endTime: s.endTime,
        location: s.location,
        weeks: s.weeks,
      })),
    },
  };
}

function dueMatch(a: Assignment, due: "overdue" | "today" | "3days" | "7days" | "all" | undefined, now: Date): boolean {
  if (!due || due === "all") return true;
  const ddl = parseLocalDDL(a.ddl);
  if (!ddl) return false;
  const diff = differenceInDays(ddl, now);
  switch (due) {
    case "overdue":
      return a.status !== "completed" && diff < 0 && !isToday(ddl);
    case "today":
      return isToday(ddl);
    case "3days":
      return a.status !== "completed" && diff >= 0 && diff <= 3;
    case "7days":
      return a.status !== "completed" && diff >= 0 && diff <= 7;
  }
}

/**
 * 任务的 StudyBlock 学习安排（deterministic）：
 * scheduledMinutes 用 timeToMinutes 计算；end <= start 的非法块跳过。
 */
function assignmentSchedule(state: ReadToolState, a: Assignment): { scheduledMinutes: number; blocks: { id: string; date: string; startTime: string; endTime: string; source: string | null }[] } {
  const blocks = state.studyBlocks
    .filter((b) => b.assignmentId === a.id)
    .map((b) => {
      const s = timeToMinutes(b.startTime);
      const e = timeToMinutes(b.endTime);
      return { b, minutes: s !== null && e !== null && e > s ? e - s : null };
    })
    .filter((x) => x.minutes !== null)
    .map((x) => ({
      id: x.b.id,
      date: x.b.date,
      startTime: x.b.startTime,
      endTime: x.b.endTime,
      source: x.b.source ?? "manual",
    }));
  const scheduledMinutes = blocks.reduce(
    (sum, x) => sum + (timeToMinutes(x.endTime)! - timeToMinutes(x.startTime)!),
    0
  );
  return { scheduledMinutes, blocks };
}

export function searchAssignments(state: ReadToolState, input: unknown): ReadToolResult<unknown> {
  const parsed = safeParse<{ query?: string; courseId?: string; status?: Assignment["status"]; due?: "overdue" | "today" | "3days" | "7days" | "all"; scope?: "focus" | "today" | "upcoming" | "at-risk" | "unscheduled" | "all" | "archive" }>("search_assignments", input);
  if (!parsed.ok) return parsed;
  const { query, courseId, status, due, scope } = parsed.data;
  const now = new Date();
  const q = (query ?? "").trim().toLowerCase();

  // Task V2 scope：复用 Workspace 同一套 view 派生（focus/today/upcoming/at-risk/unscheduled/all/archive）
  let matches: Assignment[];
  if (scope) {
    const { items } = deriveTaskWorkspace(state.assignments, state.studyBlocks, scope, now);
    matches = items.map((it) => it.task);
  } else {
    matches = state.assignments;
  }

  const filtered = matches
    .filter((a) => {
      if (courseId && a.courseId !== courseId) return false;
      if (status && a.status !== status) return false;
      if (q && !a.title.toLowerCase().includes(q) && !a.description.toLowerCase().includes(q)) return false;
      if (scope) {
        // scope 已按视图过滤；due 与 scope 同时给出时忽略 due（避免语义冲突）
        return true;
      }
      if (!dueMatch(a, due, now)) return false;
      return true;
    })
    .slice(0, 20);

  return {
    ok: true,
    data: filtered.map((a) => ({
      id: a.id,
      courseId: a.courseId,
      courseName: courseName(state, a.courseId),
      title: a.title,
      ddl: a.ddl ?? null,
      deadline: a.ddl ?? null,
      priority: a.priority,
      status: a.status,
      progress: a.progress,
      tags: a.tags ?? [],
    })),
  };
}

export function getAssignment(state: ReadToolState, input: unknown): ReadToolResult<unknown> {
  const parsed = safeParse<{ assignmentId: string }>("get_assignment", input);
  if (!parsed.ok) return parsed;
  const a = findAssignment(state, parsed.data.assignmentId);
  if (!a) return notFound("未找到对应任务。");
  const schedule = assignmentSchedule(state, a);
  // Task 6A：关联资料 metadata（只含 id/title/type/size/uploadDate；不读正文）
  const linkedMaterials = resolveAssignmentMaterials(a, state.courses).map(materialMeta);

  return {
    ok: true,
    data: {
      id: a.id,
      courseId: a.courseId,
      courseName: courseName(state, a.courseId),
      title: a.title,
      description: a.description,
      hasDeadline: parseLocalDDL(a.ddl) !== null,
      deadline: a.ddl ?? null,
      ddl: a.ddl ?? null,
      estimatedMinutes: a.estimatedMinutes ?? null,
      schedule: {
        scheduledMinutes: schedule.scheduledMinutes,
        blocks: schedule.blocks,
      },
      priority: a.priority,
      status: a.status,
      progress: a.progress,
      tags: a.tags ?? [],
      subtasks: a.subtasks ?? [],
      linkedMaterials,
      // Task 7F：重复任务元信息（只暴露 recurrence / seriesId；recurrenceParentId 无必要）
      recurrence: a.recurrence ?? null,
      recurrenceSeriesId: a.recurrenceSeriesId ?? null,
    },
  };
}

export function getAssignmentSchedule(state: ReadToolState, input: unknown): ReadToolResult<unknown> {
  const parsed = safeParse<{ assignmentId: string }>("get_assignment_schedule", input);
  if (!parsed.ok) return parsed;
  const a = findAssignment(state, parsed.data.assignmentId);
  if (!a) return notFound("未找到对应任务。");
  const schedule = assignmentSchedule(state, a);

  return {
    ok: true,
    data: {
      assignmentId: a.id,
      assignmentTitle: a.title,
      estimatedMinutes: a.estimatedMinutes ?? null,
      scheduledMinutes: schedule.scheduledMinutes,
      blocks: schedule.blocks,
    },
  };
}

export function getAssignmentHealth(state: ReadToolState, input: unknown): ReadToolResult<unknown> {
  const parsed = safeParse<{ assignmentId: string }>("get_assignment_health", input);
  if (!parsed.ok) return parsed;
  const a = findAssignment(state, parsed.data.assignmentId);
  if (!a) return notFound("未找到对应任务。");
  const now = new Date();

  // Deadline 前可用空闲分钟：now → deadline（Deadline 当天截止到 Deadline 时刻）
  let availableMinutesBeforeDeadline: number | undefined;
  if (a.ddl) {
    const deadline = parseLocalDDL(a.ddl);
    if (deadline && deadline.getTime() > now.getTime()) {
      const dlDate = a.ddl.slice(0, 10);
      const dlMinutes = deadline.getHours() * 60 + deadline.getMinutes();
      const slots = findFreeTime({
        start: now,
        end: deadline,
        semester: state.semester,
        currentSemesterWeek: state.currentSemesterWeek,
        schedules: state.schedules,
        calendarMarks: state.calendarMarks,
        studyBlocks: state.studyBlocks,
        dayCapMinutesByDate: { [dlDate]: dlMinutes },
      });
      availableMinutesBeforeDeadline = slots.reduce((sum, s) => sum + s.minutes, 0);
    }
  }

  const health = deriveAssignmentHealth({
    assignment: a,
    studyBlocks: state.studyBlocks,
    now,
    availableMinutesBeforeDeadline,
  });

  return { ok: true, data: health };
}

export function getAvailableTime(state: ReadToolState, input: unknown): ReadToolResult<unknown> {
  const parsed = safeParse<{ startDate: string; endDate: string; minimumMinutes?: number; beforeDeadlineOfAssignmentId?: string }>("get_available_time", input);
  if (!parsed.ok) return parsed;
  const { startDate, endDate, minimumMinutes, beforeDeadlineOfAssignmentId } = parsed.data;
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T23:59:59`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return invalidInput("日期格式不合法。");
  if (end < start) return invalidInput("结束日期早于开始日期。");
  if (differenceInDays(end, start) > 30) return { ok: false, code: "OUT_OF_RANGE", message: "查询范围最长 30 天。" };

  const dayCapMinutesByDate: Record<string, number> = {};
  let effectiveEnd = end;
  if (beforeDeadlineOfAssignmentId) {
    const a = findAssignment(state, beforeDeadlineOfAssignmentId);
    if (!a) return notFound("未找到对应任务。");
    if (a.ddl) {
      const deadline = parseLocalDDL(a.ddl);
      if (deadline) {
        if (deadline.getTime() < end.getTime()) effectiveEnd = deadline;
        const dlDate = a.ddl.slice(0, 10);
        if (dlDate >= startDate && dlDate <= endDate) {
          dayCapMinutesByDate[dlDate] = deadline.getHours() * 60 + deadline.getMinutes();
        }
      }
    }
  }

  const slots = findFreeTime({
    start,
    end: effectiveEnd,
    semester: state.semester,
    currentSemesterWeek: state.currentSemesterWeek,
    schedules: state.schedules,
    calendarMarks: state.calendarMarks,
    studyBlocks: state.studyBlocks,
    dayCapMinutesByDate,
    minimumSlotMinutes: minimumMinutes,
  });

  // totalMinutes 必须基于完整（未截断）slots 求和；slots 详情仍最多返回 20 条
  const totalMinutes = slots.reduce((sum, slot) => sum + slot.minutes, 0);

  return { ok: true, data: { startDate, endDate, totalMinutes, slots: slots.slice(0, 20) } };
}

export function proposeStudyPlanTool(state: ReadToolState, input: unknown): ReadToolResult<unknown> {
  const parsed = safeParse<{ assignmentIds: string[]; fromDate?: string; toDate?: string }>("propose_study_plan", input);
  if (!parsed.ok) return parsed;
  const { assignmentIds, fromDate, toDate } = parsed.data;

  const now = new Date();
  // 本周（默认窗口）：周一 → 周日；可被 fromDate/toDate 覆盖
  const weekStart = getWeekDateRange(state.semester, state.currentSemesterWeek)[0];
  const fromStr = fromDate ?? format(weekStart, "yyyy-MM-dd");
  const toStr = toDate ?? format(new Date(weekStart.getTime() + 6 * 86400000), "yyyy-MM-dd");

  const targets = assignmentIds
    .map((id) => findAssignment(state, id))
    .filter((a): a is Assignment => a !== null);
  if (targets.length === 0) return notFound("未找到对应任务。");

  const result = proposeStudyPlan({
    assignments: targets,
    studyBlocks: state.studyBlocks,
    semester: state.semester,
    currentSemesterWeek: state.currentSemesterWeek,
    schedules: state.schedules,
    calendarMarks: state.calendarMarks,
    fromDate: fromStr,
    toDate: toStr,
    now,
  });

  return {
    ok: true,
    data: {
      fromDate: fromStr,
      toDate: toStr,
      items: result.items,
      reasons: result.reasons,
    },
  };
}

export function proposeTaskBreakdownTool(state: ReadToolState, input: unknown): ReadToolResult<unknown> {
  // 模型生成的 Proposal 严格 schema 校验（invalid → INVALID_INPUT，UI 不显示 Apply）
  const parsed = safeParse<TaskBreakdownProposalInput>("propose_task_breakdown", input);
  if (!parsed.ok) return parsed;
  const proposal = parseTaskBreakdownProposal(parsed.data);
  if (!proposal) return invalidInput("任务拆解建议不符合要求（步骤 2–8 项、标题 1–120 字符）。");

  const a = findAssignment(state, proposal.assignmentId);
  if (!a) return notFound("未找到对应任务。");

  return {
    ok: true,
    data: {
      proposal: {
        ...proposal,
        assignmentId: a.id,
        assignmentTitle: a.title,
        courseName: courseName(state, a.courseId),
      },
    },
  };
}

/** propose_task_breakdown 输入形状（与 TaskBreakdownProposal 一致；schema 校验为准） */
interface TaskBreakdownProposalInput {
  assignmentId: string;
  subtasks?: { title: string; estimatedMinutes?: number }[];
  suggestedEstimatedMinutes?: number;
  rationale?: string[];
}

export function listReminders(state: ReadToolState, input: unknown): ReadToolResult<unknown> {
  const parsed = safeParse<{
    query?: string;
    targetType?: string;
    targetId?: string;
    status?: "scheduled" | "fired" | "skipped" | "all";
    from?: string;
    to?: string;
    limit?: number;
  }>("list_reminders", input);
  if (!parsed.ok) return parsed;
  const { query, targetType, targetId, status, from, to, limit } = parsed.data;
  const reminders = state.reminders ?? [];
  const q = (query ?? "").trim().toLowerCase();
  const fromMs = from ? parseLocalDDL(from)?.getTime() ?? null : null;
  const toMs = to ? parseLocalDDL(to)?.getTime() ?? null : null;

  const matches = reminders.filter((r) => {
    if (status && status !== "all" && r.status !== status) return false;
    if (targetType && r.targetType !== targetType) return false;
    if (targetId && r.targetId !== targetId) return false;
    if (q && !r.title.toLowerCase().includes(q) && !(r.note ?? "").toLowerCase().includes(q)) return false;
    const t = parseLocalDDL(r.triggerAt)?.getTime() ?? null;
    if (t === null) return false;
    if (fromMs !== null && t < fromMs) return false;
    if (toMs !== null && t > toMs) return false;
    return true;
  });

  // scheduled：triggerAt 升序（最早在前）；fired/skipped/all：最近优先
  const ascending = status === "scheduled" || status === undefined;
  matches.sort((a, b) => {
    const at = parseLocalDDL(a.triggerAt)?.getTime() ?? 0;
    const bt = parseLocalDDL(b.triggerAt)?.getTime() ?? 0;
    return ascending ? at - bt : bt - at;
  });

  return {
    ok: true,
    data: matches.slice(0, limit ?? 20).map((r) => ({
      id: r.id,
      title: r.title,
      note: r.note ?? null,
      targetType: r.targetType,
      targetId: r.targetId ?? null,
      timingMode: r.timingMode,
      offsetMinutes: r.offsetMinutes ?? null,
      triggerAt: r.triggerAt,
      status: r.status,
      readAt: r.readAt ?? null,
      source: r.source,
    })),
  };
}

export function getFocusStatus(state: ReadToolState): ReadToolResult<unknown> {
  const active = (state.focusSessions ?? []).find(
    (s) => s.status === "running" || s.status === "paused"
  );
  if (!active) return { ok: true, data: { active: false } };

  // 时间事实必须来自 deriveFocusClock（模型不得自己计算）
  const clock = deriveFocusClock(active, Date.now());
  const assignment =
    active.assignmentId !== undefined
      ? state.assignments.find((a) => a.id === active.assignmentId)
      : undefined;
  const course = active.courseId !== undefined ? state.courses.find((c) => c.id === active.courseId) : undefined;

  return {
    ok: true,
    data: {
      active: true,
      sessionId: active.id,
      status: active.status,
      plannedMinutes: active.plannedMinutes,
      elapsedActiveMs: clock.elapsedMs,
      remainingMs: clock.remainingMs,
      assignmentId: active.assignmentId ?? null,
      assignmentTitle: assignment?.title ?? active.assignmentTitleSnapshot ?? null,
      courseId: active.courseId ?? null,
      courseName: course?.name ?? active.courseNameSnapshot ?? null,
      note: active.note ?? null,
    },
  };
}

export function getUpcomingAssignments(state: ReadToolState, input: unknown): ReadToolResult<unknown> {
  const parsed = safeParse<{ days?: number; limit?: number }>("get_upcoming_assignments", input);
  if (!parsed.ok) return parsed;
  const days = parsed.data.days ?? 7;
  const limit = parsed.data.limit ?? 10;
  const now = new Date();

  const upcoming = state.assignments
    .filter((a) => {
      if (a.status === "completed") return false;
      const ddl = parseLocalDDL(a.ddl);
      if (!ddl) return false;
      const diff = differenceInDays(ddl, now);
      return diff >= -days && diff <= days; // 逾期在窗口内单独标记
    })
    .sort((a, b) => (parseLocalDDL(a.ddl)?.getTime() ?? 0) - (parseLocalDDL(b.ddl)?.getTime() ?? 0))
    .slice(0, limit);

  return {
    ok: true,
    data: {
      windowDays: days,
      items: upcoming.map((a) => {
        const ddl = parseLocalDDL(a.ddl);
        return {
          id: a.id,
          courseId: a.courseId,
          courseName: courseName(state, a.courseId),
          title: a.title,
          ddl: a.ddl,
          priority: a.priority,
          status: a.status,
          isOverdue: ddl ? differenceInDays(ddl, now) < 0 && !isToday(ddl) : false,
        };
      }),
    },
  };
}

export function searchGroupProjects(state: ReadToolState, input: unknown): ReadToolResult<unknown> {
  const parsed = safeParse<{ query?: string; courseId?: string }>("search_group_projects", input);
  if (!parsed.ok) return parsed;
  const q = (parsed.data.query ?? "").trim().toLowerCase();

  const matches = state.groupProjects.filter((p) => {
    if (parsed.data.courseId && p.courseId !== parsed.data.courseId) return false;
    if (q && !p.title.toLowerCase().includes(q) && !p.description.toLowerCase().includes(q)) return false;
    return true;
  });

  return {
    ok: true,
    data: matches.map((p) => ({
      id: p.id,
      courseId: p.courseId,
      courseName: courseName(state, p.courseId),
      title: p.title,
      progress: p.progress,
      updatedAt: p.updatedAt,
      memberCount: p.members.length,
      taskCount: p.tasks.length,
    })),
  };
}

export function getGroupProject(state: ReadToolState, input: unknown): ReadToolResult<unknown> {
  const parsed = safeParse<{ projectId: string }>("get_group_project", input);
  if (!parsed.ok) return parsed;
  const p = findProject(state, parsed.data.projectId);
  if (!p) return notFound("未找到对应小组项目。");

  return {
    ok: true,
    data: {
      project: {
        id: p.id,
        courseId: p.courseId,
        courseName: courseName(state, p.courseId),
        title: p.title,
        description: p.description,
        progress: p.progress,
        updatedAt: p.updatedAt,
      },
      members: p.members.map((m) => ({ id: m.id, name: m.name, role: m.role, major: m.major ?? null })),
      tasks: p.tasks.map((t) => {
        const assignee = t.assigneeId ? p.members.find((m) => m.id === t.assigneeId) : undefined;
        return {
          id: t.id,
          title: t.title,
          assigneeId: t.assigneeId ?? null,
          assigneeName: assignee?.name ?? null,
          ddl: t.ddl,
          completed: t.completed,
        };
      }),
    },
  };
}

export function getGroupTasks(state: ReadToolState, input: unknown): ReadToolResult<unknown> {
  const parsed = safeParse<{ projectId: string; assigneeId?: string; completed?: boolean }>("get_group_tasks", input);
  if (!parsed.ok) return parsed;
  const p = findProject(state, parsed.data.projectId);
  if (!p) return notFound("未找到对应小组项目。");

  const tasks = p.tasks.filter((t) => {
    if (parsed.data.assigneeId && t.assigneeId !== parsed.data.assigneeId) return false;
    if (parsed.data.completed !== undefined && t.completed !== parsed.data.completed) return false;
    return true;
  });

  return {
    ok: true,
    data: tasks.map((t) => {
      const assignee = t.assigneeId ? p.members.find((m) => m.id === t.assigneeId) : undefined;
      return {
        id: t.id,
        title: t.title,
        assigneeId: t.assigneeId ?? null,
        assigneeName: assignee?.name ?? null,
        // 本地 wall-clock 原样返回：不做任何时区转换
        ddl: t.ddl,
        completed: t.completed,
      };
    }),
  };
}

export function getCalendarRange(state: ReadToolState, input: unknown): ReadToolResult<unknown> {
  const parsed = safeParse<{ startDate: string; endDate: string; types?: CalendarMark["type"][] }>("get_calendar_range", input);
  if (!parsed.ok) return parsed;
  const { startDate, endDate, types } = parsed.data;
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T23:59:59`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return invalidInput("日期格式不合法。");
  if (end < start) return invalidInput("结束日期早于开始日期。");
  const days = differenceInDays(end, start);
  if (days > 90) return { ok: false, code: "OUT_OF_RANGE", message: "时间范围最长 90 天。" };

  const marks = state.calendarMarks.filter((m) => {
    const date = m.date;
    if (date < startDate || date > endDate) return false;
    if (types && types.length > 0 && !types.includes(m.type)) return false;
    return true;
  });

  return {
    ok: true,
    data: marks.map((m) => {
      const extra: { assignmentTitle?: string; courseName?: string } = {};
      if (m.type === "ddl" && m.sourceId) {
        const a = findAssignment(state, m.sourceId);
        if (a) {
          extra.assignmentTitle = a.title;
          extra.courseName = courseName(state, a.courseId);
        }
      }
      return { id: m.id, date: m.date, type: m.type, title: m.title, sourceId: m.sourceId ?? null, ...extra };
    }),
  };
}

export function getMaterialMetadata(state: ReadToolState, input: unknown): ReadToolResult<unknown> {
  const parsed = safeParse<{ courseId?: string; materialId?: string }>("get_material_metadata", input);
  if (!parsed.ok) return parsed;
  const { courseId, materialId } = parsed.data;

  if (materialId) {
    for (const c of state.courses) {
      const m = c.materials.find((x) => x.id === materialId);
      if (m) {
        return { ok: true, data: { courseId: c.id, courseName: c.name, material: materialMeta(m) } };
      }
    }
    return notFound("未找到对应资料。");
  }

  if (courseId) {
    const c = findCourse(state, courseId);
    if (!c) return notFound("未找到对应课程。");
    return { ok: true, data: { courseId: c.id, courseName: c.name, materials: c.materials.map(materialMeta) } };
  }

  return {
    ok: true,
    data: state.courses.map((c) => ({
      courseId: c.id,
      courseName: c.name,
      materials: c.materials.map(materialMeta),
    })),
  };
}

// ---------- 统一入口 ----------

/** 同步执行的 Read Tools（read_material / history / analytics / outlook 为异步重量级工具，独立处理） */
const EXECUTORS: Record<Exclude<KiroReadToolName, "read_material" | "query_learning_history" | "summarize_learning_history" | "get_learning_analytics" | "get_learning_outlook">, (state: ReadToolState, input: unknown) => ReadToolResult<unknown>> = {
  get_current_context: getCurrentContext,
  get_user_study_profile: getUserStudyProfile,
  search_courses: searchCourses,
  get_course: getCourse,
  get_week_schedule: getWeekSchedule,
  search_assignments: searchAssignments,
  get_assignment: getAssignment,
  get_assignment_schedule: getAssignmentSchedule,
  get_assignment_health: getAssignmentHealth,
  get_available_time: getAvailableTime,
  propose_study_plan: proposeStudyPlanTool,
  get_upcoming_assignments: getUpcomingAssignments,
  search_group_projects: searchGroupProjects,
  get_group_project: getGroupProject,
  get_group_tasks: getGroupTasks,
  get_calendar_range: getCalendarRange,
  get_material_metadata: getMaterialMetadata,
  propose_task_breakdown: proposeTaskBreakdownTool,
  list_reminders: listReminders,
  get_focus_status: getFocusStatus,
};

/**
 * Client Read Tool Executor：唯一执行入口。
 * pure / deterministic / no mutations / no toast / no confirm / no setState。
 */
export function executeKiroReadTool(
  toolName: string,
  input: unknown,
  state: ReadToolState
): ReadToolResult<unknown> {
  if (
    toolName === "read_material" ||
    toolName === "query_learning_history" ||
    toolName === "summarize_learning_history" ||
    toolName === "get_learning_analytics" ||
    toolName === "get_learning_outlook"
  ) {
    return { ok: false, code: "INVALID_INPUT", message: `${toolName} 需要异步执行。` };
  }
  const executor = EXECUTORS[toolName as Exclude<KiroReadToolName, "read_material" | "query_learning_history" | "summarize_learning_history" | "get_learning_analytics" | "get_learning_outlook">];
  if (!executor) {
    return { ok: false, code: "INVALID_INPUT", message: `未知工具：${toolName}` };
  }
  return executor(state, input);
}

/** 循环保护：每用户回合最多读取次数 */
export const MAX_READ_TOOL_CALLS_PER_TURN = 10;

/** 未使用但保持导出：供测试确认 DDL 本地语义不被破坏 */
export { getLocalDDLDate, getLocalDDLTime };
