import { z } from "zod";
import { TaskBreakdownProposalSchema } from "@/lib/tasks/taskBreakdown";
import { MAX_SCANNED_PDF_PAGES_PER_TURN } from "@/lib/ai/attachments/limits";

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

/** V1.3A：read_project_file schema —— 只接受 projectFileId（Project 身份来自 frozen Turn Context，
 *  不接受 projectId/storageKey/path/url） */
export const readProjectFileSchema = z
  .object({
    projectFileId: z.string().trim().min(1).max(120),
  })
  .strict();

/** V1.3B：read_project_visual schema —— 只接受 projectFileId + 可选 pages；
 *  不接受 projectId/storageKey/path/url/provider/model/apiKey（全部来自 frozen Turn Context） */
export const readProjectVisualSchema = z
  .object({
    projectFileId: z.string().trim().min(1).max(120),
    pages: z
      .array(z.number().int().min(1).max(10000))
      .min(1)
      .max(MAX_SCANNED_PDF_PAGES_PER_TURN)
      .optional(),
  })
  .strict();

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
export const queryLearningHistorySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "格式应为 YYYY-MM-DD").optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "格式应为 YYYY-MM-DD").optional(),
  eventTypes: z
    .array(
      z.enum([
        "assignment.created",
        "assignment.status_changed",
        "assignment.completed",
        "assignment.reopened",
        "assignment.deadline_changed",
        "assignment.estimate_changed",
        "assignment.priority_changed",
        "assignment.deleted",
        "assignment.restored",
        "study_block.created",
        "study_block.updated",
        "study_block.deleted",
        "focus.started",
        "focus.paused",
        "focus.resumed",
        "focus.completed",
        "course.created",
        "course.updated",
        "course.deleted",
        "schedule.created",
        "schedule.updated",
        "schedule.deleted",
        "semester.updated",
      ])
    )
    .max(23)
    .optional(),
  courseId: z.string().trim().min(1).max(120).optional(),
  assignmentId: z.string().trim().min(1).max(120).optional(),
  source: z.enum(["manual", "kiro", "system", "import"]).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export const summarizeLearningHistorySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "格式应为 YYYY-MM-DD").optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "格式应为 YYYY-MM-DD").optional(),
  courseId: z.string().trim().min(1).max(120).optional(),
  groupBy: z.enum(["none", "day", "semester-week", "course"]).optional(),
});

/**
 * Canonical Analytics Tool：返回与「学习洞察」页面同源的确定性 Analytics Snapshot。
 * 不允许模型传 now / from / to / historyStartedAt：period 由客户端当前真实环境（本地时钟 + 当前学期）决定。
 * strict：未知键直接拒绝（模型不能偷传时间参数）。
 */
export const getLearningAnalyticsSchema = z
  .object({
    preset: z.enum(["week", "4weeks", "semester"]).default("week"),
  })
  .strict();

/**
 * Canonical Outlook Tool：未来 7 / 14 天确定性学习前瞻。
 * 只允许 7 / 14（不要自定义任意范围）；period 由客户端当前真实环境决定。
 */
export const getLearningOutlookSchema = z
  .object({
    horizonDays: z.union([z.literal(7), z.literal(14)]).default(7),
  })
  .strict();

/**
 * Rebalance Proposal Tool：只移动已有 Kiro StudyBlock（move-only）。
 * READ / PROPOSAL：绝不写 Store；manual StudyBlock 不会被移动。
 */
export const proposeStudyRebalanceSchema = z
  .object({
    horizonDays: z.union([z.literal(7), z.literal(14)]).default(7),
  })
  .strict();

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
  read_project_file: readProjectFileSchema,
  read_project_visual: readProjectVisualSchema,
  propose_task_breakdown: proposeTaskBreakdownSchema,
  list_reminders: listRemindersSchema,
  get_focus_status: emptyInputSchema,
  query_learning_history: queryLearningHistorySchema,
  summarize_learning_history: summarizeLearningHistorySchema,
  get_learning_analytics: getLearningAnalyticsSchema,
  get_learning_outlook: getLearningOutlookSchema,
  propose_study_rebalance: proposeStudyRebalanceSchema,
} as const;

export type KiroReadToolName = keyof typeof KIRO_READ_TOOL_SCHEMAS;
