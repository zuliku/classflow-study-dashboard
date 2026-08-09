import { z } from "zod";

/** Write Tool 输入 Schema（zod）。客户端 Executor 始终再次 safeParse，不信任 Provider。 */

const LOCAL_DDL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;
const LOCAL_GROUP_DDL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEK_RE = /^(1-16周|1-8周|9-16周|单周|双周)$/;

const PRIORITY = z.enum(["urgent", "high", "medium", "low"]);
const ASSIGNMENT_STATUS = z.enum(["todo", "doing", "submitted", "completed"]);
const MEMBER_ROLE = z.enum(["leader", "member"]);

export const createAssignmentSchema = z.object({
  courseId: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  ddl: z.string().regex(LOCAL_DDL_RE, "截止时间必须为本地时间 YYYY-MM-DDTHH:mm[:ss]"),
  priority: PRIORITY.optional(),
  status: ASSIGNMENT_STATUS.optional(),
  progress: z.number().int().min(0).max(100).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

export const updateAssignmentSchema = z.object({
  assignmentId: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

export const setAssignmentDDLSchema = z.object({
  assignmentId: z.string().trim().min(1).max(120),
  ddl: z.string().regex(LOCAL_DDL_RE, "截止时间必须为本地时间 YYYY-MM-DDTHH:mm[:ss]"),
});

export const setAssignmentPrioritySchema = z.object({
  assignmentId: z.string().trim().min(1).max(120),
  priority: PRIORITY,
});

export const setAssignmentStatusSchema = z.object({
  assignmentId: z.string().trim().min(1).max(120),
  status: ASSIGNMENT_STATUS,
});

export const setAssignmentProgressSchema = z.object({
  assignmentId: z.string().trim().min(1).max(120),
  progress: z.number().int().min(0).max(100),
});

export const toggleAssignmentSubtaskSchema = z.object({
  assignmentId: z.string().trim().min(1).max(120),
  subtaskId: z.string().trim().min(1).max(120),
});

export const deleteAssignmentSchema = z.object({
  assignmentId: z.string().trim().min(1).max(120),
});

export const createScheduleSchema = z.object({
  courseId: z.string().trim().min(1).max(120),
  dayOfWeek: z.number().int().min(1).max(7),
  startTime: z.string().regex(TIME_RE, "时间格式必须为 HH:mm"),
  endTime: z.string().regex(TIME_RE, "时间格式必须为 HH:mm"),
  location: z.string().trim().min(1).max(120).optional(),
  weeks: z.string().regex(WEEK_RE, "周次必须是 1-16周 / 1-8周 / 9-16周 / 单周 / 双周").optional(),
});

export const moveScheduleSchema = z.object({
  scheduleId: z.string().trim().min(1).max(120),
  dayOfWeek: z.number().int().min(1).max(7),
  startTime: z.string().regex(TIME_RE, "时间格式必须为 HH:mm"),
});

export const resizeScheduleSchema = z.object({
  scheduleId: z.string().trim().min(1).max(120),
  endTime: z.string().regex(TIME_RE, "时间格式必须为 HH:mm"),
});

export const updateScheduleSchema = z.object({
  scheduleId: z.string().trim().min(1).max(120),
  dayOfWeek: z.number().int().min(1).max(7).optional(),
  startTime: z.string().regex(TIME_RE, "时间格式必须为 HH:mm").optional(),
  endTime: z.string().regex(TIME_RE, "时间格式必须为 HH:mm").optional(),
  location: z.string().trim().min(1).max(120).optional(),
  weeks: z.string().regex(WEEK_RE, "周次必须是 1-16周 / 1-8周 / 9-16周 / 单周 / 双周").optional(),
});

export const excludeScheduleWeekSchema = z.object({
  scheduleId: z.string().trim().min(1).max(120),
  week: z.number().int().min(1).max(30),
});

export const deleteScheduleSchema = z.object({
  scheduleId: z.string().trim().min(1).max(120),
});

export const createCourseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().min(1).max(40).optional(),
  teacher: z.string().trim().min(1).max(80).optional(),
  classroom: z.string().trim().min(1).max(80).optional(),
  credit: z.number().min(0).max(20).optional(),
  description: z.string().max(2000).optional(),
});

export const updateCourseSchema = z.object({
  courseId: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(120).optional(),
  code: z.string().trim().min(1).max(40).optional(),
  teacher: z.string().trim().min(1).max(80).optional(),
  classroom: z.string().trim().min(1).max(80).optional(),
  credit: z.number().min(0).max(20).optional(),
  description: z.string().max(2000).optional(),
});

export const createGroupProjectSchema = z.object({
  courseId: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
});

export const updateGroupProjectSchema = z.object({
  projectId: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
});

export const addGroupMemberSchema = z.object({
  projectId: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(80),
  role: MEMBER_ROLE.optional(),
  major: z.string().trim().min(1).max(80).optional(),
});

export const updateGroupMemberSchema = z.object({
  projectId: z.string().trim().min(1).max(120),
  memberId: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(80).optional(),
  role: MEMBER_ROLE.optional(),
  major: z.string().trim().min(1).max(80).optional(),
});

export const createGroupTaskSchema = z.object({
  projectId: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200),
  ddl: z.string().regex(LOCAL_GROUP_DDL_RE, "截止时间必须为本地时间 YYYY-MM-DDTHH:mm:ss"),
  assigneeId: z.string().trim().min(1).max(120).nullable().optional(),
});

export const updateGroupTaskSchema = z.object({
  projectId: z.string().trim().min(1).max(120),
  taskId: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200).optional(),
});

export const assignGroupTaskSchema = z.object({
  projectId: z.string().trim().min(1).max(120),
  taskId: z.string().trim().min(1).max(120),
  assigneeId: z.string().trim().min(1).max(120).nullable(),
});

export const setGroupTaskDDLSchema = z.object({
  projectId: z.string().trim().min(1).max(120),
  taskId: z.string().trim().min(1).max(120),
  ddl: z.string().regex(LOCAL_GROUP_DDL_RE, "截止时间必须为本地时间 YYYY-MM-DDTHH:mm:ss"),
});

export const toggleGroupTaskSchema = z.object({
  projectId: z.string().trim().min(1).max(120),
  taskId: z.string().trim().min(1).max(120),
});

/** Change Set（Task 8）：严格 discriminated union；risk 字段不存在（Risk 由 ClassFlow 计算） */
export const applyChangeSetSchema = z.object({
  summary: z.string().trim().min(1).max(200).optional(),
  actions: z
    .array(
      z.discriminatedUnion("tool", [
        z.object({ tool: z.literal("update_assignment"), input: updateAssignmentSchema }),
        z.object({ tool: z.literal("set_assignment_ddl"), input: setAssignmentDDLSchema }),
        z.object({ tool: z.literal("set_assignment_priority"), input: setAssignmentPrioritySchema }),
        z.object({ tool: z.literal("set_assignment_status"), input: setAssignmentStatusSchema }),
        z.object({ tool: z.literal("set_assignment_progress"), input: setAssignmentProgressSchema }),
        z.object({ tool: z.literal("toggle_assignment_subtask"), input: toggleAssignmentSubtaskSchema }),
        z.object({ tool: z.literal("delete_assignment"), input: deleteAssignmentSchema }),
        z.object({ tool: z.literal("move_schedule"), input: moveScheduleSchema }),
        z.object({ tool: z.literal("resize_schedule"), input: resizeScheduleSchema }),
        z.object({ tool: z.literal("update_schedule"), input: updateScheduleSchema }),
        z.object({ tool: z.literal("exclude_schedule_week"), input: excludeScheduleWeekSchema }),
        z.object({ tool: z.literal("delete_schedule"), input: deleteScheduleSchema }),
        z.object({ tool: z.literal("update_course"), input: updateCourseSchema }),
        z.object({ tool: z.literal("update_group_project"), input: updateGroupProjectSchema }),
        z.object({ tool: z.literal("update_group_member"), input: updateGroupMemberSchema }),
        z.object({ tool: z.literal("update_group_task"), input: updateGroupTaskSchema }),
        z.object({ tool: z.literal("assign_group_task"), input: assignGroupTaskSchema }),
        z.object({ tool: z.literal("set_group_task_ddl"), input: setGroupTaskDDLSchema }),
        z.object({ tool: z.literal("toggle_group_task"), input: toggleGroupTaskSchema }),
      ])
    )
    .min(1)
    .max(8),
});

/** Write Tool 输入 schema 注册表（tool name → zod schema） */
export const KIRO_WRITE_TOOL_SCHEMAS = {
  create_assignment: createAssignmentSchema,
  update_assignment: updateAssignmentSchema,
  set_assignment_ddl: setAssignmentDDLSchema,
  set_assignment_priority: setAssignmentPrioritySchema,
  set_assignment_status: setAssignmentStatusSchema,
  set_assignment_progress: setAssignmentProgressSchema,
  toggle_assignment_subtask: toggleAssignmentSubtaskSchema,
  delete_assignment: deleteAssignmentSchema,
  create_schedule: createScheduleSchema,
  move_schedule: moveScheduleSchema,
  resize_schedule: resizeScheduleSchema,
  update_schedule: updateScheduleSchema,
  exclude_schedule_week: excludeScheduleWeekSchema,
  delete_schedule: deleteScheduleSchema,
  create_course: createCourseSchema,
  update_course: updateCourseSchema,
  create_group_project: createGroupProjectSchema,
  update_group_project: updateGroupProjectSchema,
  add_group_member: addGroupMemberSchema,
  update_group_member: updateGroupMemberSchema,
  create_group_task: createGroupTaskSchema,
  update_group_task: updateGroupTaskSchema,
  assign_group_task: assignGroupTaskSchema,
  set_group_task_ddl: setGroupTaskDDLSchema,
  toggle_group_task: toggleGroupTaskSchema,
  apply_change_set: applyChangeSetSchema,
} as const;

export type KiroWriteToolName = keyof typeof KIRO_WRITE_TOOL_SCHEMAS;
