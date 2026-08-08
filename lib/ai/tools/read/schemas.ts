import { z } from "zod";

/**
 * Kiro Read Tool 输入 Schema（zod）。
 * 简单、明确、enum 有限、有 min/max；客户端 Executor 继续用同一 schema 验证。
 */

export const emptyInputSchema = z.object({});

export const searchCoursesSchema = z.object({
  query: z.string().trim().min(1).max(80).optional(),
});

export const getCourseSchema = z.object({
  courseId: z.string().trim().min(1).max(120),
});

export const getWeekScheduleSchema = z.object({
  week: z.number().int().min(1).max(30).optional(),
  courseId: z.string().trim().min(1).max(120).optional(),
});

const ASSIGNMENT_STATUS = z.enum(["todo", "doing", "submitted", "completed"]);
const DUE_FILTER = z.enum(["overdue", "today", "3days", "7days", "all"]);

export const searchAssignmentsSchema = z.object({
  query: z.string().trim().min(1).max(120).optional(),
  courseId: z.string().trim().min(1).max(120).optional(),
  status: ASSIGNMENT_STATUS.optional(),
  due: DUE_FILTER.optional(),
});

export const getAssignmentSchema = z.object({
  assignmentId: z.string().trim().min(1).max(120),
});

export const getUpcomingAssignmentsSchema = z.object({
  days: z.number().int().min(1).max(30).default(7),
  limit: z.number().int().min(1).max(20).default(10),
});

export const searchGroupProjectsSchema = z.object({
  query: z.string().trim().min(1).max(120).optional(),
  courseId: z.string().trim().min(1).max(120).optional(),
});

export const getGroupProjectSchema = z.object({
  projectId: z.string().trim().min(1).max(120),
});

export const getGroupTasksSchema = z.object({
  projectId: z.string().trim().min(1).max(120),
  assigneeId: z.string().trim().min(1).max(120).optional(),
  completed: z.boolean().optional(),
});

const CALENDAR_TYPES = z.enum(["course", "ddl", "exam", "activity"]);

export const getCalendarRangeSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必须为 YYYY-MM-DD"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必须为 YYYY-MM-DD"),
  types: z.array(CALENDAR_TYPES).min(1).max(4).optional(),
});

export const getMaterialMetadataSchema = z.object({
  courseId: z.string().trim().min(1).max(120).optional(),
  materialId: z.string().trim().min(1).max(120).optional(),
});

/** Read Tool 输入 schema 注册表（tool name → zod schema；server/client 共用） */
export const KIRO_READ_TOOL_SCHEMAS = {
  get_current_context: emptyInputSchema,
  get_user_study_profile: emptyInputSchema,
  search_courses: searchCoursesSchema,
  get_course: getCourseSchema,
  get_week_schedule: getWeekScheduleSchema,
  search_assignments: searchAssignmentsSchema,
  get_assignment: getAssignmentSchema,
  get_upcoming_assignments: getUpcomingAssignmentsSchema,
  search_group_projects: searchGroupProjectsSchema,
  get_group_project: getGroupProjectSchema,
  get_group_tasks: getGroupTasksSchema,
  get_calendar_range: getCalendarRangeSchema,
  get_material_metadata: getMaterialMetadataSchema,
} as const;

export type KiroReadToolName = keyof typeof KIRO_READ_TOOL_SCHEMAS;
