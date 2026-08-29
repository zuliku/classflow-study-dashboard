import { z } from "zod";

/** Write Tool 输入 Schema（zod）。客户端 Executor 始终再次 safeParse，不信任 Provider。 */

const LOCAL_DDL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;
const LOCAL_GROUP_DDL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEK_RE = /^(1-16周|1-8周|9-16周|单周|双周)$/;

const PRIORITY = z.enum(["urgent", "high", "medium", "low"]);
const ASSIGNMENT_STATUS = z.enum(["todo", "doing", "submitted", "completed"]);
const MEMBER_ROLE = z.enum(["leader", "member"]);

/** 正整数预计耗时（分钟）；缺失 = 未知，禁止伪造默认值；上限由 normalizeEstimatedMinutes 统一处理 */
const ESTIMATED_MINUTES = z.number().int().positive().max(7 * 24 * 60);

export const createAssignmentSchema = z.object({
  courseId: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  /** 可选 DDL：任务允许没有截止时间（不要凭空生成 DDL 填满 schema） */
  ddl: z.string().regex(LOCAL_DDL_RE, "截止时间必须为本地时间 YYYY-MM-DDTHH:mm[:ss]").optional(),
  estimatedMinutes: ESTIMATED_MINUTES.optional(),
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
  /** 预计耗时（分钟）；null = 清除预计耗时 */
  estimatedMinutes: ESTIMATED_MINUTES.nullable().optional(),
});

export const setAssignmentDDLSchema = z.object({
  assignmentId: z.string().trim().min(1).max(120),
  /** string = 设置/修改截止时间；null = 清除截止时间（日历标记同步删除） */
  ddl: z.string().regex(LOCAL_DDL_RE, "截止时间必须为本地时间 YYYY-MM-DDTHH:mm[:ss]").nullable(),
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

/** Task 7G-B：Reminder 工具（相对/绝对；不进入 Change Set V1） */

const REMINDER_TARGET = z.enum(["assignment", "studyBlock", "calendarMark", "standalone"]);
const REMINDER_RELATIVE_TARGET = z.enum(["assignment", "studyBlock", "calendarMark"]);
/** 提前 0 到 30 天（负数）；V1 不允许正 offset（不支持「开始后提醒」） */
const REMINDER_OFFSET = z.number().int().min(-43200).max(0);

export const createReminderSchema = z.discriminatedUnion("timingMode", [
  z.object({
    title: z.string().trim().min(1).max(200),
    note: z.string().max(500).optional(),
    targetType: REMINDER_RELATIVE_TARGET,
    targetId: z.string().trim().min(1).max(120),
    timingMode: z.literal("relative"),
    offsetMinutes: REMINDER_OFFSET,
  }),
  z.object({
    title: z.string().trim().min(1).max(200),
    note: z.string().max(500).optional(),
    timingMode: z.literal("absolute"),
    triggerAt: z.string().regex(LOCAL_DDL_RE, "提醒时间必须为本地时间 YYYY-MM-DDTHH:mm[:ss]"),
    /** 缺省 = standalone（独立提醒）；非 standalone 必须提供真实 targetId */
    targetType: REMINDER_TARGET.optional(),
    targetId: z.string().trim().min(1).max(120).optional(),
  }),
]);

export const updateReminderSchema = z.object({
  reminderId: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200).optional(),
  note: z.string().max(500).nullable().optional(),
  timingMode: z.enum(["relative", "absolute"]).optional(),
  offsetMinutes: REMINDER_OFFSET.optional(),
  triggerAt: z.string().regex(LOCAL_DDL_RE, "提醒时间必须为本地时间 YYYY-MM-DDTHH:mm[:ss]").optional(),
  // 禁止 retarget（换目标 = 删除旧 + 新建新）
});

export const deleteReminderSchema = z.object({
  reminderId: z.string().trim().min(1).max(120),
});

export const createRemindersBatchSchema = z.object({
  items: z.array(createReminderSchema).min(1).max(8),
});

export const updateRemindersBatchSchema = z.object({
  updates: z
    .array(
      z.object({
        reminderId: z.string().trim().min(1).max(120),
        title: z.string().trim().min(1).max(200).optional(),
        note: z.string().max(500).nullable().optional(),
        timingMode: z.enum(["relative", "absolute"]).optional(),
        offsetMinutes: z.number().int().min(-43200).max(0).optional(),
        triggerAt: z.string().regex(LOCAL_DDL_RE, "提醒时间必须为本地时间 YYYY-MM-DDTHH:mm[:ss]").optional(),
      })
    )
    .min(1)
    .max(8),
});

export const deleteRemindersBatchSchema = z.object({
  reminderIds: z.array(z.string().trim().min(1).max(120)).min(1).max(8),
});

/** P3 扩展：日历写入（仅 exam/activity；course/ddl 由课程/作业驱动） */
export const createCalendarMarkSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期必须为 YYYY-MM-DD"),
    type: z.enum(["exam", "activity"]),
    title: z.string().trim().min(1).max(100),
    startTime: z.string().regex(TIME_RE, "时间格式必须为 HH:mm").optional(),
    endTime: z.string().regex(TIME_RE, "时间格式必须为 HH:mm").optional(),
  })
  .refine(
    (d) => {
      if ((d.startTime && !d.endTime) || (!d.startTime && d.endTime)) return false;
      if (d.startTime && d.endTime && d.startTime >= d.endTime) return false;
      return true;
    },
    { message: "startTime/endTime 必须成对且 endTime 晚于 startTime", path: ["endTime"] }
  );

export const deleteCalendarMarkSchema = z.object({
  markId: z.string().trim().min(1).max(120),
});

export const linkMaterialsToAssignmentSchema = z.object({
  assignmentId: z.string().trim().min(1).max(120),
  materialIds: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
});

export const deleteCourseSchema = z.object({
  courseId: z.string().trim().min(1).max(120),
});

export const updateSemesterConfigSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期必须为 YYYY-MM-DD").optional(),
  totalWeeks: z.number().int().min(1).max(30).optional(),
});

/** Task 5：Focus 工具（有界：不创建 timer / 不实现 Undo） */
export const startFocusSessionSchema = z.object({
  plannedMinutes: z.number().int().min(1).max(240),
  assignmentId: z.string().trim().min(1).max(120).optional(),
  courseId: z.string().trim().min(1).max(120).optional(),
  note: z.string().trim().max(200).optional(),
});
export const pauseFocusSessionSchema = z.object({});
export const resumeFocusSessionSchema = z.object({});
export const finishFocusSessionSchema = z.object({});

/** G1：StudyBlock 直接 CRUD（单块精准操作，绕过 Proposal） */
export const createStudyBlockSchema = z.object({
  title: z.string().trim().min(1).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期必须为 YYYY-MM-DD"),
  startTime: z.string().regex(TIME_RE, "时间格式必须为 HH:mm"),
  endTime: z.string().regex(TIME_RE, "时间格式必须为 HH:mm"),
  assignmentId: z.string().trim().min(1).max(120).optional(),
  courseId: z.string().trim().min(1).max(120).optional(),
  source: z.enum(["manual", "kiro"]).optional().default("kiro"),
}).refine((d) => d.startTime < d.endTime, { message: "endTime 必须晚于 startTime", path: ["endTime"] });

export const updateStudyBlockSchema = z.object({
  blockId: z.string().trim().min(1).max(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期必须为 YYYY-MM-DD").optional(),
  startTime: z.string().regex(TIME_RE, "时间格式必须为 HH:mm").optional(),
  endTime: z.string().regex(TIME_RE, "时间格式必须为 HH:mm").optional(),
  title: z.string().trim().min(1).max(200).optional(),
  assignmentId: z.string().trim().min(1).max(120).nullable().optional(),
}).refine((d) => !(d.startTime && d.endTime && d.startTime >= d.endTime), { message: "时间区间非法", path: ["endTime"] });

export const deleteStudyBlocksSchema = z.object({
  blockIds: z.array(z.string().trim().min(1).max(120)).min(1).max(8),
});

/** G2：课程外观（bgHex/borderHex/textHex） */
export const updateCourseAppearanceSchema = z.object({
  courseId: z.string().trim().min(1).max(120),
  bgHex: z.string().regex(/^#[0-9a-fA-F]{6}$/, "颜色必须为 #RRGGBB").optional(),
  borderHex: z.string().regex(/^#[0-9a-fA-F]{6}$/, "颜色必须为 #RRGGBB").optional(),
  textHex: z.string().regex(/^#[0-9a-fA-F]{6}$/, "颜色必须为 #RRGGBB").optional(),
}).refine((d) => !!(d.bgHex || d.borderHex || d.textHex), { message: "至少提供一个外观字段", path: ["bgHex"] });

/** G6：偏好与用户档案 */
export const updatePreferencesSchema = z.object({
  defaultDeadlineReminderMinutes: z.union([z.literal(60), z.literal(1440), z.literal(4320), z.literal(10080)]).optional(),
  defaultTaskPriority: z.enum(["urgent", "high", "medium", "low"]).optional(),
  defaultTaskWorkspaceView: z.enum(["focus", "today", "upcoming", "at-risk", "unscheduled", "all", "archive"]).optional(),
  contentDensity: z.enum(["comfortable", "compact"]).optional(),
  uiFont: z.enum(["harmonyos-sans-sc", "source-han-sans-sc", "misan"]).optional(),
  showWeekends: z.boolean().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: "至少一项", path: ["defaultTaskPriority"] });

export const updateUserProfileSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  college: z.string().trim().min(1).max(80).optional(),
  grade: z.string().trim().min(1).max(40).optional(),
  studentId: z.string().trim().max(40).optional(),
}).refine((d) => Object.keys(d).length > 0, { message: "至少一项", path: ["name"] });

/** Task 7：一次性停课/调课/补课（只影响指定教学周，不修改 recurring schedule） */
export const cancelScheduleOccurrenceSchema = z.object({
  scheduleId: z.string().trim().min(1).max(120),
  week: z.number().int().min(1).max(30),
});
export const moveScheduleOccurrenceSchema = z.object({
  scheduleId: z.string().trim().min(1).max(120),
  week: z.number().int().min(1).max(30),
  dayOfWeek: z.number().int().min(1).max(7),
  startTime: z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  location: z.string().trim().max(200).optional(),
});
export const createExtraScheduleOccurrenceSchema = z.object({
  courseId: z.string().trim().min(1).max(120),
  week: z.number().int().min(1).max(30),
  dayOfWeek: z.number().int().min(1).max(7),
  startTime: z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  location: z.string().trim().max(200).optional(),
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
  cancel_schedule_occurrence: cancelScheduleOccurrenceSchema,
  move_schedule_occurrence: moveScheduleOccurrenceSchema,
  create_extra_schedule_occurrence: createExtraScheduleOccurrenceSchema,
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
  create_reminder: createReminderSchema,
  update_reminder: updateReminderSchema,
  delete_reminder: deleteReminderSchema,
  create_reminders_batch: createRemindersBatchSchema,
  update_reminders_batch: updateRemindersBatchSchema,
  delete_reminders_batch: deleteRemindersBatchSchema,
  create_calendar_mark: createCalendarMarkSchema,
  delete_calendar_mark: deleteCalendarMarkSchema,
  link_materials_to_assignment: linkMaterialsToAssignmentSchema,
  delete_course: deleteCourseSchema,
  update_semester_config: updateSemesterConfigSchema,
  start_focus_session: startFocusSessionSchema,
  pause_focus_session: pauseFocusSessionSchema,
  resume_focus_session: resumeFocusSessionSchema,
  finish_focus_session: finishFocusSessionSchema,
  create_study_block: createStudyBlockSchema,
  update_study_block: updateStudyBlockSchema,
  delete_study_blocks: deleteStudyBlocksSchema,
  update_course_appearance: updateCourseAppearanceSchema,
  update_preferences: updatePreferencesSchema,
  update_user_profile: updateUserProfileSchema,
} as const;

export type KiroWriteToolName = keyof typeof KIRO_WRITE_TOOL_SCHEMAS;
