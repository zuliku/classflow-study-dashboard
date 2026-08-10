import { z } from "zod";
import { TaskBreakdownProposalSchema } from "@/lib/tasks/taskBreakdown";

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
/** Task V2 action scope（与 Assignment Workspace 视图同源；Today = 今天截止 OR 今天有 StudyBlock；at-risk 由 Deadline Health 派生） */
const ASSIGNMENT_SCOPE = z.enum(["focus", "today", "upcoming", "at-risk", "unscheduled", "all", "archive"]);

export const searchAssignmentsSchema = z.object({
  query: z.string().trim().min(1).max(120).optional(),
  courseId: z.string().trim().min(1).max(120).optional(),
  status: ASSIGNMENT_STATUS.optional(),
  due: DUE_FILTER.optional(),
  /** Task V2 scope：focus/today/upcoming/at-risk/unscheduled/all/archive（与 Workspace 视图同一套规则） */
  scope: ASSIGNMENT_SCOPE.optional(),
});

export const getAssignmentSchema = z.object({
  assignmentId: z.string().trim().min(1).max(120),
});

export const getAssignmentScheduleSchema = z.object({
  assignmentId: z.string().trim().min(1).max(120),
});

export const getAssignmentHealthSchema = z.object({
  assignmentId: z.string().trim().min(1).max(120),
});

export const getAvailableTimeSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必须为 YYYY-MM-DD"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必须为 YYYY-MM-DD"),
  /** 最短空闲时段（分钟），默认 30 */
  minimumMinutes: z.number().int().min(15).max(240).optional(),
  /** 提供任务 ID 时：终点自动不超过该任务 Deadline（Deadline 当天最多到 Deadline 时刻） */
  beforeDeadlineOfAssignmentId: z.string().trim().min(1).max(120).optional(),
});

export const proposeStudyPlanSchema = z.object({
  /** 要安排的任务（最多 8 个）；overdue 任务不会被安排 */
  assignmentIds: z.array(z.string().trim().min(1).max(120)).min(1).max(8),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必须为 YYYY-MM-DD").optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必须为 YYYY-MM-DD").optional(),
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

export const readMaterialSchema = z.object({
  courseId: z.string().trim().min(1).max(120),
  materialId: z.string().trim().min(1).max(120),
});

/** 任务拆解 + 估时 Proposal 输入（模型生成结构化建议；与 TaskBreakdownProposal 同 schema） */
export const proposeTaskBreakdownSchema = TaskBreakdownProposalSchema;

/** Task 7G-B：本地墙钟 datetime（无 Z / 无时区偏移） */
const LOCAL_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;

export const listRemindersSchema = z.object({
  query: z.string().trim().min(1).max(120).optional(),
  targetType: z.enum(["assignment", "studyBlock", "calendarMark", "standalone"]).optional(),
  targetId: z.string().trim().min(1).max(120).optional(),
  /** 默认只返回尚未触发的 scheduled reminders */
  status: z.enum(["scheduled", "fired", "skipped", "all"]).default("scheduled"),
  from: z.string().regex(LOCAL_DATETIME_RE, "时间必须为本地时间 YYYY-MM-DDTHH:mm[:ss]").optional(),
  to: z.string().regex(LOCAL_DATETIME_RE, "时间必须为本地时间 YYYY-MM-DDTHH:mm[:ss]").optional(),
  limit: z.number().int().min(1).max(50).default(20),
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
  get_assignment_schedule: getAssignmentScheduleSchema,
  get_assignment_health: getAssignmentHealthSchema,
  get_available_time: getAvailableTimeSchema,
  propose_study_plan: proposeStudyPlanSchema,
  get_upcoming_assignments: getUpcomingAssignmentsSchema,
  search_group_projects: searchGroupProjectsSchema,
  get_group_project: getGroupProjectSchema,
  get_group_tasks: getGroupTasksSchema,
  get_calendar_range: getCalendarRangeSchema,
  get_material_metadata: getMaterialMetadataSchema,
  read_material: readMaterialSchema,
  propose_task_breakdown: proposeTaskBreakdownSchema,
  list_reminders: listRemindersSchema,
} as const;

export type KiroReadToolName = keyof typeof KIRO_READ_TOOL_SCHEMAS;
