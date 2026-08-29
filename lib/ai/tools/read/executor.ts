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
  ScheduleOccurrenceOverride,
  StudyBlock,
} from "@/types";
import { parseLocalDDL, getLocalDDLDate, getLocalDDLTime } from "@/lib/ddl";
import { getSemesterWeek, getWeekDateRange } from "@/lib/semester";
import { timeToMinutes } from "@/lib/schedule";
import { resolveCourseOccurrencesForWeek } from "@/lib/scheduleOccurrences";
import { deriveTaskWorkspace } from "@/lib/tasks/taskViews";
import { deriveAssignmentHealth } from "@/lib/tasks/taskHealth";
import { parseTaskBreakdownProposal } from "@/lib/tasks/taskBreakdown";
import { resolveAssignmentMaterials } from "@/lib/tasks/taskMaterials";
import { deriveFocusClock } from "@/lib/focus/focusDomain";
import { findFreeTime } from "@/lib/planning/freeTime";
import { proposeStudyPlan } from "@/lib/planning/studyPlanner";
import { proposeStudyRebalance } from "@/lib/planning/studyRebalance";
import { KIRO_READ_TOOL_SCHEMAS, KiroReadToolName } from "@/lib/ai/tools/read/schemas";
import type { AppState } from "@/store/useAppStore";
import { DEFAULT_PREFERENCES } from "@/lib/preferences";
import { buildVisualActionProposal } from "@/lib/ai/visual/preflight";
import { ProposeVisualActionsInput } from "@/lib/ai/visual/schemas";
import { VisualPendingContinuation } from "@/lib/ai/visual/continuation";
import { buildTimetableImportProposal } from "@/lib/ai/timetableImport/preflight";
import { ProposeTimetableImportInput } from "@/lib/ai/timetableImport/schemas";

/**
 * Read Tool Executor：pure / deterministic / no mutations。
 * state 每次执行时由调用方传入最新 useAppStore.getState()，绝不缓存旧数据。
 * 工具输出统一 envelope：ok / code / message / candidates。
 */

export type ReadToolErrorCode =
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "AMBIGUOUS"
  | "OUT_OF_RANGE"
  | "FILE_MISSING"
  | "READ_FAILED"
  // Visual Action Intake（Task B / V1.1）：Proposal 结构化失败
  | "VISUAL_SOURCE_REQUIRED"
  | "VISUAL_UNSUPPORTED_ACTION"
  | "VISUAL_DUPLICATE_ASSIGNMENT"
  | "TRANSACTION_TOO_LARGE"
  | "TRANSACTION_UNSUPPORTED"
  | "TRANSACTION_CONTRADICTORY"
  | "TRANSACTION_INTEGRITY"
  | "CONFLICT";

/** Turn-level trusted context（V1.1/V1.2.1）：只给真正需要的工具；普通 Read Tools 完全忽略 */
export interface ReadToolExecutionContext {
  /** 当前 User Turn Send 时冻结的 ready image attachment IDs（Runtime Source of Truth） */
  visualSourceAttachmentIds?: readonly string[];
  /**
   * V1.2.1：活跃的 Visual Pending Continuation（完整数据，不是 boolean 权限位）。
   * 澄清链 Turn 无新图片时，Proposal 来源授权必须由真实 continuation 数据支撑。
   */
  visualPendingContinuation?: VisualPendingContinuation | null;
  /** Eval V1.1：deterministic clock override（Evaluator 用固定时间；生产不传 = 运行时真实时钟） */
  now?: Date;
  timezone?: string;
}

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
  /** Task 7：一次性停课/调课/补课（optional：旧 fixture 回落 []） */
  scheduleOccurrenceOverrides?: ScheduleOccurrenceOverride[];
  /** Task B：Visual Proposal preflight 需要（optional：旧 fixture 回落 DEFAULT_PREFERENCES） */
  preferences?: AppState["preferences"];
  bellSchedules?: AppState["bellSchedules"];
  activeBellScheduleId?: AppState["activeBellScheduleId"];
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

export function getCurrentContext(state: ReadToolState, _input: unknown, context?: ReadToolExecutionContext): ReadToolResult<unknown> {
  // Eval V1.1：deterministic clock override（Evaluator 传固定 now/timezone；生产不传 → 运行时真实时钟）
  const now = context?.now ?? new Date();
  const timezone = context?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "local";
  return {
    ok: true,
    data: {
      activeTab: state.activeTab,
      currentWeek: state.currentSemesterWeek,
      semesterName: state.semester.name,
      now: format(now, "yyyy-MM-dd HH:mm EEEE", { locale: zhCN }),
      timezone,
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

  // Task 7：一次性停课/调课/补课（recurring schedule 的周级例外；temporary，不改变 base）
  const temporaryChanges = (state.scheduleOccurrenceOverrides ?? [])
    .filter((o) => o.courseId === course.id)
    .map((o) => ({
      kind: o.kind,
      week: o.week,
      baseScheduleId: o.kind === "extra" ? undefined : o.baseScheduleId,
      dayOfWeek: o.kind === "cancel" ? undefined : o.dayOfWeek,
      startTime: o.kind === "cancel" ? undefined : o.startTime,
      endTime: o.kind === "cancel" ? undefined : o.endTime,
      location: o.kind === "cancel" ? undefined : o.location,
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
      temporaryChanges,
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
  // Task 7：该周 effective occurrences（cancel 消失 / move 目标位 / extra 出现）
  const activeSchedules = resolveCourseOccurrencesForWeek({
    schedules: state.schedules,
    overrides: state.scheduleOccurrenceOverrides ?? [],
    week,
    totalWeeks: state.semester.totalWeeks,
  })
    .filter((o) => (parsed.data.courseId ? o.courseId === parsed.data.courseId : true))
    .sort(
      (a, b) =>
        a.dayOfWeek - b.dayOfWeek ||
        (timeToMinutes(a.startTime) ?? 0) - (timeToMinutes(b.startTime) ?? 0)
    );

  return {
    ok: true,
    data: {
      week,
      weekStartDate: format(weekStart, "yyyy-MM-dd"),
      entries: activeSchedules.map((o) => ({
        scheduleId: o.baseScheduleId ?? o.occurrenceId,
        courseId: o.courseId,
        courseName: courseName(state, o.courseId),
        dayOfWeek: o.dayOfWeek,
        startTime: o.startTime,
        endTime: o.endTime,
        location: o.location,
        source: o.source,
        overrideId: o.overrideId,
        weeks: o.baseScheduleId
          ? state.schedules.find((s) => s.id === o.baseScheduleId)?.weeks
          : undefined,
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
  const parsed = safeParse<{
    query?: string;
    courseId?: string;
    status?: Assignment["status"];
    due?: "overdue" | "today" | "3days" | "7days" | "all";
    scope?: "focus" | "today" | "upcoming" | "at-risk" | "unscheduled" | "all" | "archive";
    priority?: Assignment["priority"];
    tag?: string;
    hasDDL?: boolean;
    hasEstimatedMinutes?: boolean;
    sortBy?: "ddl" | "priority" | "health";
    includeHealth?: boolean;
  }>("search_assignments", input);
  if (!parsed.ok) return parsed;
  const { query, courseId, status, due, scope, priority, tag, hasDDL, hasEstimatedMinutes, sortBy, includeHealth } = parsed.data;
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

  let filtered = matches.filter((a) => {
    if (courseId && a.courseId !== courseId) return false;
    if (status && a.status !== status) return false;
    if (priority && a.priority !== priority) return false;
    if (tag && !(a.tags ?? []).includes(tag)) return false;
    if (hasDDL !== undefined && hasDDL !== (a.ddl != null)) return false;
    if (hasEstimatedMinutes !== undefined && hasEstimatedMinutes !== (a.estimatedMinutes != null)) return false;
    if (q && !a.title.toLowerCase().includes(q) && !a.description.toLowerCase().includes(q)) return false;
    if (scope) {
      // scope 已按视图过滤；due 与 scope 同时给出时忽略 due（避免语义冲突）
      return true;
    }
    if (!dueMatch(a, due, now)) return false;
    return true;
  });

  if (sortBy === "ddl") {
    filtered = filtered.sort((a, b) => {
      if (!a.ddl && !b.ddl) return 0;
      if (!a.ddl) return 1;
      if (!b.ddl) return -1;
      return a.ddl.localeCompare(b.ddl);
    });
  } else if (sortBy === "priority") {
    const order: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
    filtered = filtered.sort((a, b) => (order[a.priority] ?? 99) - (order[b.priority] ?? 99));
  } else if (sortBy === "health" && includeHealth) {
    filtered = filtered.sort((a, b) => {
      const ha = deriveAssignmentHealth({ assignment: a, studyBlocks: state.studyBlocks, now }).state;
      const hb = deriveAssignmentHealth({ assignment: b, studyBlocks: state.studyBlocks, now }).state;
      const rank: Record<string, number> = { overdue: 0, "at-risk": 1, attention: 2, safe: 3, unscheduled: 4, unknown: 5 };
      return (rank[ha] ?? 99) - (rank[hb] ?? 99);
    });
  }

  filtered = filtered.slice(0, 20);

  return {
    ok: true,
    data: filtered.map((a) => {
      const base: any = {
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
      };
      if (includeHealth) {
        base.health = deriveAssignmentHealth({ assignment: a, studyBlocks: state.studyBlocks, now });
      }
      return base;
    }),
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
  const parsed = safeParse<{ assignmentId: string; includeEvidence?: boolean; horizonDays?: 7 | 14 }>("get_assignment_health", input);
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

  const health: any = deriveAssignmentHealth({
    assignment: a,
    studyBlocks: state.studyBlocks,
    now,
    availableMinutesBeforeDeadline,
  });

  if (parsed.data.includeEvidence) {
    const horizon = parsed.data.horizonDays ?? 7;
    const horizonEnd = new Date(now);
    horizonEnd.setDate(horizonEnd.getDate() + horizon);
    const slots = findFreeTime({
      start: now,
      end: horizonEnd,
      semester: state.semester,
      currentSemesterWeek: state.currentSemesterWeek,
      schedules: state.schedules,
      calendarMarks: state.calendarMarks,
      studyBlocks: state.studyBlocks,
    });
    const total = slots.reduce((s, x) => s + x.minutes, 0);
    health.evidence = {
      horizonDays: horizon,
      availableMinutesInHorizon: total,
      slots: slots.slice(0, 5),
      gapMinutes: (a.estimatedMinutes ?? 0) - (health.scheduledMinutes ?? 0),
    };
  }

  return { ok: true, data: health };
}

export function getAvailableTime(state: ReadToolState, input: unknown): ReadToolResult<unknown> {
  const parsed = safeParse<{ startDate: string; endDate: string; minimumMinutes?: number; beforeDeadlineOfAssignmentId?: string; includeCourseOverlap?: boolean; includeStudyBlocks?: boolean }>("get_available_time", input);
  if (!parsed.ok) return parsed;
  const { startDate, endDate, minimumMinutes, beforeDeadlineOfAssignmentId, includeCourseOverlap, includeStudyBlocks } = parsed.data;
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

  const effectiveSchedules = includeCourseOverlap ? [] : state.schedules;
  const effectiveStudyBlocks = includeStudyBlocks === false ? [] : state.studyBlocks;

  const slots = findFreeTime({
    start,
    end: effectiveEnd,
    semester: state.semester,
    currentSemesterWeek: state.currentSemesterWeek,
    schedules: effectiveSchedules,
    calendarMarks: state.calendarMarks,
    studyBlocks: effectiveStudyBlocks,
    dayCapMinutesByDate,
    minimumSlotMinutes: minimumMinutes,
  });

  // totalMinutes 必须基于完整（未截断）slots 求和；slots 详情仍最多返回 20 条
  const totalMinutes = slots.reduce((sum, slot) => sum + slot.minutes, 0);

  if (includeCourseOverlap) {
    const preferredSlots = findFreeTime({
      start,
      end: effectiveEnd,
      semester: state.semester,
      currentSemesterWeek: state.currentSemesterWeek,
      schedules: state.schedules,
      calendarMarks: state.calendarMarks,
      studyBlocks: effectiveStudyBlocks,
      dayCapMinutesByDate,
      minimumSlotMinutes: minimumMinutes,
    });
    const preferredMinutes = preferredSlots.reduce((sum, s) => sum + s.minutes, 0);
    return {
      ok: true,
      data: {
        startDate,
        endDate,
        totalMinutes,
        preferredMinutes,
        combinedMinutes: totalMinutes,
        slots: slots.slice(0, 20),
        preferredSlots: preferredSlots.slice(0, 20),
      },
    };
  }

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

/** propose_study_rebalance：Browser 客户端执行（当前 Zustand state），READ / PROPOSAL，绝不写 Store */
export function proposeStudyRebalanceTool(state: ReadToolState, input: unknown): ReadToolResult<unknown> {
  const parsed = safeParse<{ horizonDays?: 7 | 14 }>("propose_study_rebalance", input);
  if (!parsed.ok) return parsed;
  const horizonDays = parsed.data.horizonDays ?? 7;

  const proposal = proposeStudyRebalance({
    assignments: state.assignments,
    studyBlocks: state.studyBlocks,
    schedules: state.schedules,
    calendarMarks: state.calendarMarks,
    semester: state.semester,
    currentSemesterWeek: state.currentSemesterWeek,
    horizonDays,
    now: new Date(),
  });

  return {
    ok: true,
    data: {
      proposal: {
        horizonDays: proposal.horizonDays,
        moves: proposal.moves.map((m) => ({
          blockId: m.blockId,
          assignmentId: m.assignmentId,
          title: m.title,
          courseId: m.courseId,
          minutes: m.minutes,
          reason: m.reason,
          from: m.from,
          to: m.to,
        })),
        summary: proposal.summary,
        reasons: proposal.reasons,
      },
    },
  };
}

/** Visual Action Intake（Task B/V1.1）：Proposal Tool，绝不写 Store；preflight 基于最新真实 Store。
 *  V1.1：必须有 Runtime 冻结的 trusted image source（模型无法提供 attachment IDs）。 */
export function proposeVisualActionsTool(
  state: ReadToolState,
  input: unknown,
  context?: ReadToolExecutionContext
): ReadToolResult<unknown> {
  const sourceAttachmentIds = context?.visualSourceAttachmentIds ?? [];
  const continuation = context?.visualPendingContinuation ?? null;
  // V1.2.1：授权必须由真实数据支撑——当前图片 IDs 或完整 trusted continuation（不再是 boolean 权限位）
  if (sourceAttachmentIds.length === 0 && !continuation) {
    return {
      ok: false,
      code: "VISUAL_SOURCE_REQUIRED",
      message: "当前用户消息没有可用的图片来源，不能创建截图操作方案。",
    };
  }
  const parsed = safeParse<ProposeVisualActionsInput>("propose_visual_actions", input);
  if (!parsed.ok) return parsed;
  const appState: AppState = {
    ...(state as unknown as AppState),
    preferences: state.preferences ?? DEFAULT_PREFERENCES,
    reminders: state.reminders ?? [],
  };
  const result = buildVisualActionProposal(parsed.data, appState, { sourceAttachmentIds, continuation });
  if (!result.ok) {
    return {
      ok: false,
      code: result.code as ReadToolErrorCode,
      message: result.message,
    };
  }
  return { ok: true, data: { proposal: result.proposal } };
}

/**
 * propose_timetable_import（Visual Timetable Import，独立于 Visual Action Intake）：
 * 根据完整课表截图输出课表初始化草稿（课程/节次/周次表达式），
 * Runtime 生成预览（Bell Schedule 节次解析 + 重复/冲突 preflight + 指纹）。
 * 模型不得提供真实 ID / 具体时间 / 附件 ID。绝不写 Store。
 */
export function proposeTimetableImportTool(
  state: ReadToolState,
  input: unknown,
  context?: ReadToolExecutionContext
): ReadToolResult<unknown> {
  const sourceAttachmentIds = context?.visualSourceAttachmentIds ?? [];
  if (sourceAttachmentIds.length === 0) {
    return {
      ok: false,
      code: "VISUAL_SOURCE_REQUIRED",
      message: "课表导入需要当前用户消息包含课程表截图。",
    };
  }
  const parsed = safeParse<ProposeTimetableImportInput>("propose_timetable_import", input);
  if (!parsed.ok) return parsed;
  const appState = state as unknown as AppState;
  const result = buildTimetableImportProposal({
    draft: parsed.data,
    sourceAttachmentIds: [...sourceAttachmentIds],
    state: {
      existingCourses: appState.courses.map((c) => ({ name: c.name, code: c.code, teacher: c.teacher })),
      existingSchedules: appState.schedules,
      bellSchedules: appState.bellSchedules ?? [],
      activeBellScheduleId: appState.activeBellScheduleId ?? null,
    },
  });
  if (!result.ok) {
    return {
      ok: false,
      code: result.code === "SOURCE_REQUIRED" ? "VISUAL_SOURCE_REQUIRED" : "INVALID_INPUT",
      message: result.message,
    };
  }
  return { ok: true, data: { proposal: result.proposal } };
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

export function queryStudyBlocks(state: ReadToolState, input: unknown): ReadToolResult<unknown> {
  const parsed = safeParse<{
    from?: string;
    to?: string;
    assignmentId?: string;
    courseId?: string;
    source?: "manual" | "kiro";
    includeReleased?: boolean;
    limit?: number;
  }>("query_study_blocks", input);
  if (!parsed.ok) return parsed;
  const { from, to, assignmentId, courseId, source, includeReleased, limit } = parsed.data;
  if (from && to && from > to) return invalidInput("from 必须早于或等于 to。");
  const fromDate = from ?? "0000-01-01";
  const toDate = to ?? "9999-12-31";
  if (to && from) {
    const diff = differenceInDays(new Date(`${to}T00:00:00`), new Date(`${from}T00:00:00`));
    if (diff > 90) return { ok: false, code: "OUT_OF_RANGE", message: "StudyBlock 查询最长 90 天。" };
  }
  const baseBlocks = (state.studyBlocks ?? []).filter((b) => {
    if (assignmentId && b.assignmentId !== assignmentId) return false;
    if (courseId && b.courseId !== courseId) return false;
    if (source && b.source !== source) return false;
    if (b.date < fromDate || b.date > toDate) return false;
    return true;
  });
  const releasedCount = baseBlocks.filter((b) => b.planningState === "released").length;
  const blocks = includeReleased ? baseBlocks : baseBlocks.filter((b) => b.planningState !== "released");
  blocks.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return (timeToMinutes(a.startTime) ?? 0) - (timeToMinutes(b.startTime) ?? 0);
  });
  const lim = limit ?? 20;
  const sliced = blocks.slice(0, lim);
  const totalMinutes = sliced.reduce((sum, b) => {
    const s = timeToMinutes(b.startTime);
    const e = timeToMinutes(b.endTime);
    return sum + (s !== null && e !== null && e > s ? e - s : 0);
  }, 0);
  return {
    ok: true,
    data: {
      from: from ?? null,
      to: to ?? null,
      totalCount: blocks.length,
      returnedCount: sliced.length,
      totalMinutes,
      releasedCount,
      blocks: sliced.map((b) => {
        const s = timeToMinutes(b.startTime);
        const e = timeToMinutes(b.endTime);
        const minutes = s !== null && e !== null && e > s ? e - s : 0;
        const assignment = b.assignmentId ? state.assignments.find((a) => a.id === b.assignmentId) : undefined;
        const course = b.courseId ? state.courses.find((c) => c.id === b.courseId) : undefined;
        return {
          id: b.id,
          title: b.title,
          date: b.date,
          startTime: b.startTime,
          endTime: b.endTime,
          minutes,
          assignmentId: b.assignmentId ?? null,
          assignmentTitle: assignment?.title ?? null,
          courseId: b.courseId ?? null,
          courseName: course?.name ?? null,
          source: b.source ?? "manual",
          planningState: b.planningState ?? "active",
        };
      }),
    },
  };
}

function parseLocalDayToMs(s: string, endOfDay: boolean): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  if (Number.isNaN(d.getTime())) return null;
  return endOfDay ? d.getTime() + 86_400_000 - 1 : d.getTime();
}

export function listFocusSessions(state: ReadToolState, input: unknown): ReadToolResult<unknown> {
  const parsed = safeParse<{
    from?: string;
    to?: string;
    courseId?: string;
    assignmentId?: string;
    status?: "running" | "paused" | "completed";
    limit?: number;
  }>("list_focus_sessions", input);
  if (!parsed.ok) return parsed;
  const { from, to, courseId, assignmentId, status, limit } = parsed.data;
  const sessions = state.focusSessions ?? [];
  const fromMs = from ? parseLocalDayToMs(from, false) : null;
  const toMs = to ? parseLocalDayToMs(to, true) : null;
  if (from && fromMs === null) return invalidInput("from 日期格式必须为 YYYY-MM-DD。");
  if (to && toMs === null) return invalidInput("to 日期格式必须为 YYYY-MM-DD。");
  if (fromMs !== null && toMs !== null && fromMs > toMs) return invalidInput("from 必须早于或等于 to。");
  if (fromMs !== null && toMs !== null && toMs - fromMs > 366 * 86_400_000) {
    return { ok: false, code: "OUT_OF_RANGE", message: "Focus 查询最长 366 天。" };
  }
  const filtered = sessions.filter((s) => {
    if (courseId && s.courseId !== courseId) return false;
    if (assignmentId && s.assignmentId !== assignmentId) return false;
    if (status && s.status !== status) return false;
    if (fromMs !== null && s.startedAt < fromMs) return false;
    if (toMs !== null && s.startedAt > toMs) return false;
    return true;
  });
  filtered.sort((a, b) => b.startedAt - a.startedAt);
  const lim = limit ?? 20;
  const sliced = filtered.slice(0, lim);
  const now = Date.now();
  return {
    ok: true,
    data: {
      totalCount: filtered.length,
      returnedCount: sliced.length,
      sessions: sliced.map((s) => {
        const isActive = s.status === "running" || s.status === "paused";
        const clock = isActive ? deriveFocusClock(s, now) : null;
        const assignment = s.assignmentId ? state.assignments.find((a) => a.id === s.assignmentId) : undefined;
        const course = s.courseId ? state.courses.find((c) => c.id === s.courseId) : undefined;
        const startedLocalDate = format(new Date(s.startedAt), "yyyy-MM-dd");
        return {
          id: s.id,
          status: s.status,
          plannedMinutes: s.plannedMinutes,
          actualActiveMs: s.actualActiveMs ?? null,
          elapsedActiveMs: isActive ? (clock?.elapsedMs ?? null) : null,
          remainingMs: isActive ? (clock?.remainingMs ?? null) : null,
          startedAt: s.startedAt,
          startedLocalDate,
          endedAt: s.endedAt ?? null,
          endReason: s.endReason ?? null,
          assignmentId: s.assignmentId ?? null,
          assignmentTitle: assignment?.title ?? s.assignmentTitleSnapshot ?? null,
          courseId: s.courseId ?? null,
          courseName: course?.name ?? s.courseNameSnapshot ?? null,
          note: s.note ?? null,
          source: s.source,
        };
      }),
    },
  };
}

export function getFocusAnalytics(state: ReadToolState, input: unknown): ReadToolResult<unknown> {
  const parsed = safeParse<{ preset?: "week" | "4weeks" | "semester" }>("get_focus_analytics", input);
  if (!parsed.ok) return parsed;
  const preset = parsed.data.preset ?? "week";
  const now = new Date();
  const nowMs = now.getTime();
  let fromMs: number;
  if (preset === "semester") {
    const semStart = new Date(`${state.semester.startDate}T00:00:00`).getTime();
    fromMs = Number.isNaN(semStart) ? nowMs - 28 * 86_400_000 : semStart;
  } else if (preset === "4weeks") {
    fromMs = nowMs - 28 * 86_400_000;
  } else {
    fromMs = nowMs - 7 * 86_400_000;
  }
  const sessions = (state.focusSessions ?? []).filter((s) => s.status === "completed" && typeof s.actualActiveMs === "number" && s.startedAt >= fromMs && s.startedAt <= nowMs);
  let totalPlanned = 0;
  let totalActualMs = 0;
  let longest = 0;
  const byCourse = new Map<string, { courseId: string; courseName: string; minutes: number; sessions: number }>();
  const byBucket = new Map<string, { minutes: number; sessions: number }>();
  const activeDates = new Set<string>();
  const hourToBucket = (h: number): "深夜" | "上午" | "下午" | "晚间" => {
    if (h < 5) return "深夜";
    if (h < 12) return "上午";
    if (h < 18) return "下午";
    return "晚间";
  };
  for (const s of sessions) {
    const actualMs = s.actualActiveMs ?? 0;
    totalPlanned += s.plannedMinutes;
    totalActualMs += actualMs;
    longest = Math.max(longest, actualMs);
    const localDate = format(new Date(s.startedAt), "yyyy-MM-dd");
    activeDates.add(localDate);
    const courseId = s.courseId ?? "__none__";
    const courseName = s.courseId ? (state.courses.find((c) => c.id === s.courseId)?.name ?? s.courseNameSnapshot ?? "未关联课程") : "未关联课程";
    const entry = byCourse.get(courseId) ?? { courseId: s.courseId ?? null, courseName, minutes: 0, sessions: 0 } as unknown as { courseId: string; courseName: string; minutes: number; sessions: number };
    entry.minutes += Math.round(actualMs / 60000);
    entry.sessions += 1;
    byCourse.set(courseId, entry);
    const bucket = hourToBucket(new Date(s.startedAt).getHours());
    const b = byBucket.get(bucket) ?? { minutes: 0, sessions: 0 };
    b.minutes += Math.round(actualMs / 60000);
    b.sessions += 1;
    byBucket.set(bucket, b);
  }
  const totalActualMinutes = Math.round(totalActualMs / 60000);
  const averageSessionMinutes = sessions.length > 0 ? Math.round(totalActualMs / sessions.length / 60000) : null;
  const longestSessionMinutes = Math.round(longest / 60000);
  const byCourseArr = Array.from(byCourse.values()).sort((a, b) => b.minutes - a.minutes);
  const byTimeOfDay = (["深夜", "上午", "下午", "晚间"] as const).map((bucket) => {
    const v = byBucket.get(bucket) ?? { minutes: 0, sessions: 0 };
    return { bucket, minutes: v.minutes, sessions: v.sessions };
  });
  let dominantTimeOfDay: "深夜" | "上午" | "下午" | "晚间" | null = null;
  if (sessions.length >= 3 && totalActualMinutes >= 60) {
    let best: { bucket: string; minutes: number } | null = null;
    for (const b of byTimeOfDay) {
      if (!best || b.minutes > best.minutes) best = b;
    }
    if (best && best.minutes > 0) dominantTimeOfDay = best.bucket as "深夜" | "上午" | "下午" | "晚间";
  }
  return {
    ok: true,
    data: {
      preset,
      range: { from: format(new Date(fromMs), "yyyy-MM-dd"), to: format(now, "yyyy-MM-dd") },
      totalSessions: sessions.length,
      totalPlannedMinutes: totalPlanned,
      totalActualMinutes,
      totalActualMs: totalActualMs,
      activeDays: activeDates.size,
      averageSessionMinutes,
      longestSessionMinutes,
      byCourse: byCourseArr,
      byTimeOfDay,
      dominantTimeOfDay,
    },
  };
}

export function getCourseMaterialLinkage(state: ReadToolState, input: unknown): ReadToolResult<unknown> {
  const parsed = safeParse<{ courseId: string; includeUnlinked?: boolean }>("get_course_material_linkage", input);
  if (!parsed.ok) return parsed;
  const { courseId, includeUnlinked } = parsed.data;
  const course = findCourse(state, courseId);
  if (!course) return notFound("未找到对应课程。");
  const courseAssignments = state.assignments.filter((a) => a.courseId === courseId);
  const materials = course.materials.map((m) => {
    const linkedAssignmentIds = courseAssignments
      .filter((a) => a.materialIds?.includes(m.id))
      .map((a) => a.id);
    return {
      materialId: m.id,
      title: m.title,
      type: m.type,
      size: m.size ?? null,
      uploadDate: m.uploadDate,
      linkedAssignmentIds,
      linkCount: linkedAssignmentIds.length,
    };
  });
  const linkedAssignmentIdSet = new Set<string>();
  for (const m of materials) {
    for (const aid of m.linkedAssignmentIds) linkedAssignmentIdSet.add(aid);
  }
  const totalAssignments = courseAssignments.length;
  const linkedAssignments = courseAssignments.filter((a) => linkedAssignmentIdSet.has(a.id)).length;
  const orphanAssignments = courseAssignments
    .filter((a) => !a.materialIds || a.materialIds.length === 0 || !a.materialIds.some((id) => course.materials.some((m) => m.id === id)))
    .map((a) => ({ id: a.id, title: a.title, status: a.status, ddl: a.ddl ?? null }));
  const coverage = totalAssignments > 0 ? Math.round((linkedAssignments / totalAssignments) * 100) / 100 : 0;
  return {
    ok: true,
    data: {
      courseId: course.id,
      courseName: course.name,
      totalMaterials: materials.length,
      totalAssignments,
      linkedAssignments,
      coverage,
      materials,
      ...(includeUnlinked ? { orphanAssignments } : {}),
    },
  };
}

export function searchCourseMaterials(state: ReadToolState, input: unknown): ReadToolResult<unknown> {
  const parsed = safeParse<{ courseId: string; query: string; maxResults?: number }>("search_course_materials", input);
  if (!parsed.ok) return parsed;
  const { courseId, query, maxResults } = parsed.data;
  const course = findCourse(state, courseId);
  if (!course) return notFound("未找到对应课程。");
  const q = query.trim().toLowerCase();
  const max = maxResults ?? 5;
  const matched = course.materials
    .filter((m) => m.title.toLowerCase().includes(q))
    .slice(0, max)
    .map((m) => ({
      materialId: m.id,
      title: m.title,
      type: m.type,
      size: m.size ?? null,
      uploadDate: m.uploadDate,
      linkedAssignmentIds: state.assignments.filter((a) => a.materialIds?.includes(m.id)).map((a) => a.id),
    }));
  return { ok: true, data: { courseId: course.id, courseName: course.name, query, results: matched } };
}

export function getPreferences(state: ReadToolState, input: unknown): ReadToolResult<unknown> {
  const parsed = safeParse<Record<string, never>>("get_preferences", input);
  if (!parsed.ok) return parsed;
  // 返回 sanitize 后的 preferences（与 useAppStore 的 sanitize 一致）
  return { ok: true, data: state.preferences };
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

export function getCalendarDensity(state: ReadToolState, input: unknown): ReadToolResult<unknown> {
  const parsed = safeParse<{ startDate: string; endDate: string; groupBy?: "day" | "week" }>("get_calendar_density", input);
  if (!parsed.ok) return parsed;
  const { startDate, endDate, groupBy } = parsed.data;
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T23:59:59`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return invalidInput("日期格式不合法。");
  if (end < start) return invalidInput("结束日期早于开始日期。");
  const days = differenceInDays(end, start);
  if (days > 90) return { ok: false, code: "OUT_OF_RANGE", message: "时间范围最长 90 天。" };
  const marks = state.calendarMarks.filter((m) => m.date >= startDate && m.date <= endDate);
  const group = groupBy ?? "day";
  if (group === "day") {
    const byDay = new Map<string, { date: string; courseCount: number; ddlCount: number; examCount: number; activityCount: number }>();
    for (const m of marks) {
      const entry = byDay.get(m.date) ?? { date: m.date, courseCount: 0, ddlCount: 0, examCount: 0, activityCount: 0 };
      if (m.type === "course") entry.courseCount += 1;
      else if (m.type === "ddl") entry.ddlCount += 1;
      else if (m.type === "exam") entry.examCount += 1;
      else if (m.type === "activity") entry.activityCount += 1;
      byDay.set(m.date, entry);
    }
    const byDayArr = Array.from(byDay.values())
      .map((d) => {
        const total = d.courseCount + d.ddlCount + d.examCount * 2 + d.activityCount;
        const pressureLabel = d.examCount > 0 && d.ddlCount > 0 ? "high" : total >= 5 ? "high" : total >= 3 ? "medium" : total >= 1 ? "low" : "low";
        return { ...d, total, pressureLabel: pressureLabel as "low" | "medium" | "high" };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
    let busiestDay: (typeof byDayArr)[number] | null = null;
    for (const d of byDayArr) {
      if (!busiestDay || d.total > busiestDay.total) busiestDay = d;
    }
    return { ok: true, data: { startDate, endDate, groupBy: "day", byDay: byDayArr, busiestDay } };
  } else {
    const byWeek = new Map<number, { week: number; weekStartDate: string; courseCount: number; ddlCount: number; examCount: number; activityCount: number }>();
    for (const m of marks) {
      const week = getSemesterWeek(new Date(`${m.date}T00:00:00`), state.semester);
      const weekNum = week >= 1 && week <= state.semester.totalWeeks ? week : 0;
      const entry = byWeek.get(weekNum) ?? { week: weekNum, weekStartDate: weekNum > 0 ? format(getWeekDateRange(state.semester, weekNum)[0], "yyyy-MM-dd") : m.date, courseCount: 0, ddlCount: 0, examCount: 0, activityCount: 0 };
      if (m.type === "course") entry.courseCount += 1;
      else if (m.type === "ddl") entry.ddlCount += 1;
      else if (m.type === "exam") entry.examCount += 1;
      else if (m.type === "activity") entry.activityCount += 1;
      byWeek.set(weekNum, entry);
    }
    const byWeekArr = Array.from(byWeek.values())
      .map((w) => {
        const total = w.courseCount + w.ddlCount + w.examCount * 2 + w.activityCount;
        const pressureLabel = w.examCount > 0 && w.ddlCount > 0 ? "high" : total >= 10 ? "high" : total >= 5 ? "medium" : "low";
        return { ...w, total, pressureLabel: pressureLabel as "low" | "medium" | "high" };
      })
      .sort((a, b) => a.week - b.week);
    let busiestWeek: (typeof byWeekArr)[number] | null = null;
    for (const w of byWeekArr) {
      if (!busiestWeek || w.total > busiestWeek.total) busiestWeek = w;
    }
    return { ok: true, data: { startDate, endDate, groupBy: "week", byWeek: byWeekArr, busiestWeek } };
  }
}

export function getGroupProjectHealth(state: ReadToolState, input: unknown): ReadToolResult<unknown> {
  const parsed = safeParse<{ projectId: string }>("get_group_project_health", input);
  if (!parsed.ok) return parsed;
  const p = findProject(state, parsed.data.projectId);
  if (!p) return notFound("未找到对应小组项目。");
  const now = Date.now();
  const tasks = p.tasks;
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.completed).length;
  const unassignedTasks = tasks.filter((t) => !t.assigneeId && !t.completed).length;
  const overdueTasks = tasks.filter((t) => {
    if (t.completed) return false;
    const ddlMs = new Date(t.ddl.replace("T", " ")).getTime();
    if (Number.isNaN(ddlMs)) return false;
    return ddlMs < now;
  }).length;
  const atRiskTasks = tasks.filter((t) => {
    if (t.completed) return false;
    const ddlMs = new Date(t.ddl.replace("T", " ")).getTime();
    if (Number.isNaN(ddlMs)) return false;
    const diffDays = (ddlMs - now) / 86_400_000;
    return diffDays >= 0 && diffDays <= 3;
  }).length;
  // 按成员聚合
  const byMember = p.members.map((m) => {
    const memberTasks = tasks.filter((t) => t.assigneeId === m.id);
    const mc = memberTasks.length;
    const mo = memberTasks.filter((t) => {
      if (t.completed) return false;
      const ddlMs = new Date(t.ddl.replace("T", " ")).getTime();
      return !Number.isNaN(ddlMs) && ddlMs < now;
    }).length;
    const mr = memberTasks.filter((t) => {
      if (t.completed) return false;
      const ddlMs = new Date(t.ddl.replace("T", " ")).getTime();
      const diffDays = (ddlMs - now) / 86_400_000;
      return diffDays >= 0 && diffDays <= 3;
    }).length;
    const completed = memberTasks.filter((t) => t.completed).length;
    return { memberId: m.id, name: m.name, role: m.role, taskCount: mc, completedTasks: completed, overdueTasks: mo, atRiskTasks: mr };
  });
  // 未分配任务按成员外统计
  const unassignedDetail = tasks.filter((t) => !t.assigneeId && !t.completed).map((t) => ({ id: t.id, title: t.title, ddl: t.ddl, completed: t.completed }));
  // 最近截止的未完成任务
  const nextDue = tasks
    .filter((t) => !t.completed)
    .map((t) => ({ t, ms: new Date(t.ddl.replace("T", " ")).getTime() }))
    .filter((x) => !Number.isNaN(x.ms))
    .sort((a, b) => a.ms - b.ms)[0];
  const progress = p.progress;
  return {
    ok: true,
    data: {
      projectId: p.id,
      title: p.title,
      courseId: p.courseId,
      courseName: courseName(state, p.courseId),
      totalTasks,
      completedTasks,
      overdueTasks,
      atRiskTasks,
      unassignedTasks,
      progress,
      nextDue: nextDue ? { id: nextDue.t.id, title: nextDue.t.title, ddl: nextDue.t.ddl, assigneeId: nextDue.t.assigneeId ?? null } : null,
      byMember,
      unassignedTasksDetail: unassignedDetail,
    },
  };
}

export function getSemesterConfig(state: ReadToolState, _input: unknown): ReadToolResult<unknown> {
  const week = state.currentSemesterWeek;
  const sem = state.semester;
  const weekStart = getWeekDateRange(sem, week)[0];
  return {
    ok: true,
    data: {
      id: sem.id,
      name: sem.name,
      startDate: sem.startDate,
      totalWeeks: sem.totalWeeks,
      currentWeek: week,
      currentWeekStartDate: format(weekStart, "yyyy-MM-dd"),
      now: format(new Date(), "yyyy-MM-dd HH:mm EEEE", { locale: zhCN }),
    },
  };
}

export function getBellSchedules(state: ReadToolState, _input: unknown): ReadToolResult<unknown> {
  const bellSchedules = (state as unknown as { bellSchedules?: unknown }).bellSchedules as unknown[] | undefined;
  const activeId = (state as unknown as { activeBellScheduleId?: string | null }).activeBellScheduleId ?? null;
  if (!Array.isArray(bellSchedules)) {
    return { ok: true, data: { bellSchedules: [], activeBellScheduleId: activeId } };
  }
  return { ok: true, data: { bellSchedules, activeBellScheduleId: activeId } };
}

export function getTodayBrief(state: ReadToolState, input: unknown): ReadToolResult<unknown> {
  const parsed = safeParse<{ date?: string }>("get_today_brief", input);
  if (!parsed.ok) return parsed;
  const today = parsed.data.date ?? format(new Date(), "yyyy-MM-dd");
  const dueToday = state.assignments.filter((a) => {
    if (a.status === "completed") return false;
    const ddl = parseLocalDDL(a.ddl);
    return ddl ? isToday(ddl) && format(ddl, "yyyy-MM-dd") === today : false;
  });
  // 更宽松的 today 判定：若 ddl 的 YYYY-MM-DD 直接等于 today（本地墙钟），也视为今日截止
  const dueTodayFallback = state.assignments.filter((a) => {
    if (a.status === "completed") return false;
    if (!a.ddl) return false;
    return a.ddl.slice(0, 10) === today;
  });
  const dueMap = new Map(dueToday.map((a) => [a.id, a]));
  for (const a of dueTodayFallback) if (!dueMap.has(a.id)) dueMap.set(a.id, a);
  const dueList = Array.from(dueMap.values());
  const scheduledToday = (state.studyBlocks ?? []).filter((b) => b.date === today && b.planningState !== "released");
  const scheduledMinutesToday = scheduledToday.reduce((sum, b) => {
    const s = timeToMinutes(b.startTime);
    const e = timeToMinutes(b.endTime);
    return sum + (s !== null && e !== null && e > s ? e - s : 0);
  }, 0);
  const calendarToday = state.calendarMarks.filter((m) => m.date === today);
  const remindersToday = (state.reminders ?? []).filter((r) => r.status === "scheduled" && r.triggerAt.slice(0, 10) === today);
  const focusActive = (state.focusSessions ?? []).find((s) => s.status === "running" || s.status === "paused");
  const focusClock = focusActive ? deriveFocusClock(focusActive, Date.now()) : null;
  return {
    ok: true,
    data: {
      date: today,
      dueToday: dueList.map((a) => ({ id: a.id, title: a.title, courseId: a.courseId, courseName: courseName(state, a.courseId), ddl: a.ddl, priority: a.priority, status: a.status })),
      scheduledToday: {
        count: scheduledToday.length,
        totalMinutes: scheduledMinutesToday,
        blocks: scheduledToday.map((b) => {
          const assignment = b.assignmentId ? state.assignments.find((a) => a.id === b.assignmentId) : undefined;
          const course = b.courseId ? state.courses.find((c) => c.id === b.courseId) : undefined;
          return { id: b.id, title: b.title, startTime: b.startTime, endTime: b.endTime, assignmentId: b.assignmentId ?? null, assignmentTitle: assignment?.title ?? null, courseId: b.courseId ?? null, courseName: course?.name ?? null, source: b.source ?? "manual" };
        }),
      },
      calendarToday: calendarToday.map((m) => ({ id: m.id, type: m.type, title: m.title, startTime: m.startTime ?? null, endTime: m.endTime ?? null })),
      focus: focusActive ? { active: true, status: focusActive.status, plannedMinutes: focusActive.plannedMinutes, elapsedActiveMs: focusClock?.elapsedMs ?? null, remainingMs: focusClock?.remainingMs ?? null, assignmentId: focusActive.assignmentId ?? null } : { active: false },
      remindersToday: remindersToday.map((r) => ({ id: r.id, title: r.title, triggerAt: r.triggerAt, targetType: r.targetType })),
      counts: { dueToday: dueList.length, scheduledToday: scheduledToday.length, calendarToday: calendarToday.length, remindersToday: remindersToday.length },
    },
  };
}

export function getWeeklyBrief(state: ReadToolState, input: unknown): ReadToolResult<unknown> {
  const parsed = safeParse<{ week?: number }>("get_weekly_brief", input);
  if (!parsed.ok) return parsed;
  const week = parsed.data.week ?? state.currentSemesterWeek;
  if (week < 1 || week > state.semester.totalWeeks) return { ok: false, code: "OUT_OF_RANGE", message: `教学周 ${week} 超出本学期范围（1-${state.semester.totalWeeks}）。` };
  const weekRange = getWeekDateRange(state.semester, week);
  const startDate = format(weekRange[0], "yyyy-MM-dd");
  const endDate = format(weekRange[6], "yyyy-MM-dd");
  const assignmentsDueThisWeek = state.assignments.filter((a) => {
    if (a.status === "completed" || !a.ddl) return false;
    const d = a.ddl.slice(0, 10);
    return d >= startDate && d <= endDate;
  });
  const studyBlocksThisWeek = (state.studyBlocks ?? []).filter((b) => b.date >= startDate && b.date <= endDate && b.planningState !== "released");
  const totalStudyMinutes = studyBlocksThisWeek.reduce((sum, b) => {
    const s = timeToMinutes(b.startTime);
    const e = timeToMinutes(b.endTime);
    return sum + (s !== null && e !== null && e > s ? e - s : 0);
  }, 0);
  const calendarThisWeek = state.calendarMarks.filter((m) => m.date >= startDate && m.date <= endDate);
  const byDay: Record<string, { date: string; courseCount: number; ddlCount: number; examCount: number; activityCount: number }> = {};
  for (const m of calendarThisWeek) {
    const d = (byDay[m.date] = byDay[m.date] ?? { date: m.date, courseCount: 0, ddlCount: 0, examCount: 0, activityCount: 0 });
    if (m.type === "course") d.courseCount += 1;
    else if (m.type === "ddl") d.ddlCount += 1;
    else if (m.type === "exam") d.examCount += 1;
    else if (m.type === "activity") d.activityCount += 1;
  }
  const focusThisWeek = (state.focusSessions ?? []).filter((s) => {
    const d = format(new Date(s.startedAt), "yyyy-MM-dd");
    return d >= startDate && d <= endDate && s.status === "completed" && typeof s.actualActiveMs === "number";
  });
  const totalFocusMinutes = focusThisWeek.reduce((sum, s) => sum + Math.round((s.actualActiveMs ?? 0) / 60000), 0);
  return {
    ok: true,
    data: {
      week,
      startDate,
      endDate,
      assignmentsDueThisWeek: assignmentsDueThisWeek.map((a) => ({ id: a.id, title: a.title, courseId: a.courseId, courseName: courseName(state, a.courseId), ddl: a.ddl, priority: a.priority, status: a.status })),
      studyBlocksThisWeek: { count: studyBlocksThisWeek.length, totalMinutes: totalStudyMinutes, byDay: Object.values(byDay) },
      calendarThisWeek: { count: calendarThisWeek.length, byDay: Object.values(byDay) },
      focusThisWeek: { completedSessions: focusThisWeek.length, totalFocusMinutes, sessions: focusThisWeek.map((s) => ({ id: s.id, plannedMinutes: s.plannedMinutes, actualActiveMs: s.actualActiveMs, startedAt: s.startedAt })) },
      counts: { assignmentsDue: assignmentsDueThisWeek.length, studyBlocks: studyBlocksThisWeek.length, calendarMarks: calendarThisWeek.length, focusSessions: focusThisWeek.length },
    },
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

export function activateSkillTool(state: ReadToolState, input: unknown): ReadToolResult<unknown> {
  const parsed = safeParse<{ skillName: string }>("activate_skill", input);
  if (!parsed.ok) return parsed;
  return { ok: false, code: "NOT_FOUND", message: `Skill not found: ${parsed.data.skillName}` };
}

export function mcpSearchToolsTool(state: ReadToolState, input: unknown): ReadToolResult<unknown> {
  const parsed = safeParse<{ query?: string; limit?: number }>("mcp_search_tools", input);
  if (!parsed.ok) return parsed;
  // 实际搜索由 Main 的 MCP Manager 完成，此处为占位（Client 将通过 IPC 调用）
  return { ok: true, data: { tools: [], query: parsed.data.query } };
}

export function mcpCallToolTool(state: ReadToolState, input: unknown): ReadToolResult<unknown> {
  const parsed = safeParse<{ connectionId: string; toolName: string; arguments?: Record<string, unknown> }>("mcp_call_tool", input);
  if (!parsed.ok) return parsed;
  // 实际调用由 Main 完成，此处为占位
  return { ok: false, code: "NOT_FOUND", message: "MCP call requires Main gateway" };
}

// ---------- 统一入口 ----------

/** 同步执行的 Read Tools（read_material / read_project_file / read_project_visual / search_project_file / history / analytics / outlook / signal 为异步重量级工具，独立处理） */
const EXECUTORS: Record<Exclude<KiroReadToolName, "read_material" | "read_project_file" | "read_project_visual" | "search_project_file" | "query_learning_history" | "summarize_learning_history" | "get_learning_analytics" | "get_learning_outlook" | "get_learning_signal">, (state: ReadToolState, input: unknown, context?: ReadToolExecutionContext) => ReadToolResult<unknown>> = {
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
  propose_study_rebalance: proposeStudyRebalanceTool,
  propose_visual_actions: proposeVisualActionsTool,
  propose_timetable_import: proposeTimetableImportTool,
  get_upcoming_assignments: getUpcomingAssignments,
  search_group_projects: searchGroupProjects,
  get_group_project: getGroupProject,
  get_group_tasks: getGroupTasks,
  get_calendar_range: getCalendarRange,
  get_calendar_density: getCalendarDensity,
  get_group_project_health: getGroupProjectHealth,
  get_semester_config: getSemesterConfig,
  get_bell_schedules: getBellSchedules,
  get_material_metadata: getMaterialMetadata,
  propose_task_breakdown: proposeTaskBreakdownTool,
  list_reminders: listReminders,
  get_focus_status: getFocusStatus,
  query_study_blocks: queryStudyBlocks,
  list_focus_sessions: listFocusSessions,
  get_focus_analytics: getFocusAnalytics,
  get_course_material_linkage: getCourseMaterialLinkage,
  search_course_materials: searchCourseMaterials,
  get_preferences: getPreferences,
  get_today_brief: getTodayBrief,
  get_weekly_brief: getWeeklyBrief,
  activate_skill: activateSkillTool,
  mcp_search_tools: mcpSearchToolsTool,
  mcp_call_tool: mcpCallToolTool,
};

/**
 * Client Read Tool Executor：唯一执行入口。
 * pure / deterministic / no mutations / no toast / no confirm / no setState。
 * context（V1.1）是 Turn-level trusted context，只有 propose_visual_actions 消费。
 */
export function executeKiroReadTool(
  toolName: string,
  input: unknown,
  state: ReadToolState,
  context?: ReadToolExecutionContext
): ReadToolResult<unknown> {
  if (
    toolName === "read_material" ||
    toolName === "read_project_file" ||
    toolName === "read_project_visual" ||
    toolName === "search_project_file" ||
    toolName === "query_learning_history" ||
    toolName === "summarize_learning_history" ||
    toolName === "get_learning_analytics" ||
    toolName === "get_learning_outlook" ||
    toolName === "get_learning_signal"
  ) {
    return { ok: false, code: "INVALID_INPUT", message: `${toolName} 需要异步执行。` };
  }
  const executor = EXECUTORS[toolName as Exclude<KiroReadToolName, "read_material" | "read_project_file" | "read_project_visual" | "search_project_file" | "query_learning_history" | "summarize_learning_history" | "get_learning_analytics" | "get_learning_outlook" | "get_learning_signal">];
  if (!executor) {
    return { ok: false, code: "INVALID_INPUT", message: `未知工具：${toolName}` };
  }
  return executor(state, input, context);
}

/** 循环保护：每用户回合最多读取次数 */
export const MAX_READ_TOOL_CALLS_PER_TURN = 10;

/** 未使用但保持导出：供测试确认 DDL 本地语义不被破坏 */
export { getLocalDDLDate, getLocalDDLTime };
