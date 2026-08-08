import { differenceInDays, isSameWeek, isToday, format } from "date-fns";
import { zhCN } from "date-fns/locale";
import {
  Assignment,
  CalendarMark,
  Course,
  CourseSchedule,
  GroupProject,
  Material,
} from "@/types";
import { parseLocalDDL, getLocalDDLDate, getLocalDDLTime } from "@/lib/ddl";
import { getSemesterWeek, getWeekDateRange } from "@/lib/semester";
import { isScheduleActive, timeToMinutes } from "@/lib/schedule";
import { KIRO_READ_TOOL_SCHEMAS, KiroReadToolName } from "@/lib/ai/tools/read/schemas";

/**
 * Read Tool Executor：pure / deterministic / no mutations。
 * state 每次执行时由调用方传入最新 useAppStore.getState()，绝不缓存旧数据。
 * 工具输出统一 envelope：ok / code / message / candidates。
 */

export type ReadToolErrorCode = "NOT_FOUND" | "INVALID_INPUT" | "AMBIGUOUS" | "OUT_OF_RANGE";

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

export function searchAssignments(state: ReadToolState, input: unknown): ReadToolResult<unknown> {
  const parsed = safeParse<{ query?: string; courseId?: string; status?: Assignment["status"]; due?: "overdue" | "today" | "3days" | "7days" | "all" }>("search_assignments", input);
  if (!parsed.ok) return parsed;
  const { query, courseId, status, due } = parsed.data;
  const now = new Date();
  const q = (query ?? "").trim().toLowerCase();

  const matches = state.assignments
    .filter((a) => {
      if (courseId && a.courseId !== courseId) return false;
      if (status && a.status !== status) return false;
      if (q && !a.title.toLowerCase().includes(q) && !a.description.toLowerCase().includes(q)) return false;
      if (!dueMatch(a, due, now)) return false;
      return true;
    })
    .slice(0, 20);

  return {
    ok: true,
    data: matches.map((a) => ({
      id: a.id,
      courseId: a.courseId,
      courseName: courseName(state, a.courseId),
      title: a.title,
      ddl: a.ddl,
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

  return {
    ok: true,
    data: {
      id: a.id,
      courseId: a.courseId,
      courseName: courseName(state, a.courseId),
      title: a.title,
      description: a.description,
      ddl: a.ddl,
      priority: a.priority,
      status: a.status,
      progress: a.progress,
      tags: a.tags ?? [],
      subtasks: a.subtasks ?? [],
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

const EXECUTORS: Record<KiroReadToolName, (state: ReadToolState, input: unknown) => ReadToolResult<unknown>> = {
  get_current_context: getCurrentContext,
  get_user_study_profile: getUserStudyProfile,
  search_courses: searchCourses,
  get_course: getCourse,
  get_week_schedule: getWeekSchedule,
  search_assignments: searchAssignments,
  get_assignment: getAssignment,
  get_upcoming_assignments: getUpcomingAssignments,
  search_group_projects: searchGroupProjects,
  get_group_project: getGroupProject,
  get_group_tasks: getGroupTasks,
  get_calendar_range: getCalendarRange,
  get_material_metadata: getMaterialMetadata,
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
  const executor = EXECUTORS[toolName as KiroReadToolName];
  if (!executor) {
    return { ok: false, code: "INVALID_INPUT", message: `未知工具：${toolName}` };
  }
  return executor(state, input);
}

/** 循环保护：每用户回合最多读取次数 */
export const MAX_READ_TOOL_CALLS_PER_TURN = 10;

/** 未使用但保持导出：供测试确认 DDL 本地语义不被破坏 */
export { getLocalDDLDate, getLocalDDLTime };
