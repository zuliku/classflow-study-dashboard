/** 工作区页面 Tab（设置是 Modal Action，不是 Tab） */
export type NavTab =
  | "overview"
  | "timetable"
  | "assignments"
  | "courses"
  | "kiro"
  | "analytics"
  | "group";

export type TaskFilter = "all" | "doing" | "todo" | "completed";

export type TimeSliceFilter = "all" | "overdue" | "today" | "3days" | "7days" | "completed";

export type Priority = "urgent" | "high" | "medium" | "low";
export type AssignmentStatus = "todo" | "doing" | "submitted" | "completed";

/** 应用启动后进入的默认位置 */
export type StartupView = "overview" | "timetable" | "assignments" | "last";
/** 新建任务的默认状态（禁止 submitted/completed，无合理产品语义） */
export type DefaultTaskStatus = "todo" | "doing";
/** 内容密度：影响任务列表/课程卡片/命令中心行高 */
export type ContentDensity = "comfortable" | "compact";

export interface UserProfile {
  name: string;
  avatarUrl: string;
  college: string;
  grade: string;
  studentId: string;
  completedCredits: number;
  totalCredits: number;
}

export interface Semester {
  id: string;
  name: string;
  startDate: string; // "YYYY-MM-DD"，开学日期（周一，学期第 1 周起始日）
  totalWeeks: number;
}

export interface Material {
  id: string;
  title: string;
  type: "pdf" | "ppt" | "doc" | "link" | "image";
  size?: string;
  uploadDate: string;
  /** IndexedDB 中的文件 Blob 键；新上传的真实文件优先使用 storageKey 持久化 */
  storageKey?: string;
  /** 兼容旧演示数据或外部链接；新上传文件优先使用 storageKey */
  url?: string; // Blob URL, Data URL, or external link for downloading & previewing
}

export interface Course {
  id: string;
  name: string;
  code: string;
  teacher: string;
  classroom: string;
  credit: number;
  bgHex: string;
  borderHex: string;
  textHex: string;
  description: string;
  materials: Material[];
}

export interface CourseSchedule {
  id: string;
  courseId: string;
  dayOfWeek: number; // 1 (Mon) - 7 (Sun)
  startTime: string; // "08:00"
  endTime: string;   // "09:40"
  location: string;
  weeks: string;     // "1-16周", "1-8周", "单周", "双周", etc.
  excludedWeeks?: number[]; // [5] means week 5 is excluded/canceled (调课/停课)
}

export interface ScheduleConflict {
  scheduleA: CourseSchedule;
  scheduleB: CourseSchedule;
  dayOfWeek: number;
  timeRange: string;
}

export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
}

/** Task 7F：重复任务规则（第一版四种；缺失 = 普通任务） */
export type TaskRecurrence = "daily" | "weekly" | "biweekly" | "monthly";

/** Task 7G-A1：Reminder 目标类型 */
export type ReminderTargetType = "assignment" | "studyBlock" | "calendarMark" | "standalone";
export type ReminderTimingMode = "relative" | "absolute";
export type ReminderStatus = "scheduled" | "fired" | "skipped";
export type ReminderSource = "manual" | "kiro";

export interface Reminder {
  id: string;
  title: string;
  note?: string;
  targetType: ReminderTargetType;
  targetId?: string;
  /**
   * relative：triggerAt = target anchor + offsetMinutes（跟随目标时间变化）
   * absolute：triggerAt 为用户明确指定时间（永不跟随）
   */
  timingMode: ReminderTimingMode;
  /** 仅 relative 使用：提前 = 负数（到期=0，提前10分钟=-10，提前1小时=-60，提前1天=-1440） */
  offsetMinutes?: number;
  /** 最终可调度的本地墙钟时间 YYYY-MM-DDTHH:mm:ss */
  triggerAt: string;
  status: ReminderStatus;
  firedAt?: string;
  readAt?: string;
  source: ReminderSource;
  createdAt: string;
  updatedAt: string;
}

/** Task 7G-A1：missed reminder policy（Reminder Runtime 消费的纯决策） */
export type MissedReminderPolicy = "deliver" | "recent-only" | "skip";

export interface Assignment {
  id: string;
  courseId: string;
  title: string;
  description: string;
  /** 可选 DDL：本地墙钟 "YYYY-MM-DDTHH:mm[:ss]"（无 Z）。缺省 = 未设截止（Task V2） */
  ddl?: string;
  /** 预计完成分钟数（无则未知，不得伪造默认值） */
  estimatedMinutes?: number;
  priority: Priority;
  status: AssignmentStatus;
  progress: number; // 0 - 100
  tags: string[];
  subtasks?: Subtask[];
  /**
   * Task 6A：关联的课程资料 ID（仅本任务所属 Course.materials 中的 ID；只存 ID 不复制 Material 对象）。
   * Course.materials 仍是 Source of Truth。无关联 = undefined。
   */
  materialIds?: string[];
  /** Task 7F：重复规则；有 recurrence 必须有有效 DDL（normalize 强制）；缺失 = 普通任务 */
  recurrence?: TaskRecurrence;
  /** 同一重复任务系列的稳定 ID（首次开启时 Domain 层创建） */
  recurrenceSeriesId?: string;
  /** 该 occurrence 由哪个上一 occurrence 自动生成（idempotency：一个 occurrence 最多生成一个 child） */
  recurrenceParentId?: string;
}

export interface GroupMember {
  id: string;
  name: string;
  /** 可选：无头像时由 UI 使用姓名首字 fallback */
  avatarUrl?: string;
  role: "leader" | "member";
  /** 可选：不再强制每个成员必须有专业 */
  major?: string;
}

export interface GroupTask {
  id: string;
  title: string;
  /** 关联项目成员；undefined = 未分配 */
  assigneeId?: string;
  ddl: string; // 本地时间 "YYYY-MM-DDTHH:mm:ss"（无 Z）
  completed: boolean;
}

export interface GroupProject {
  id: string;
  courseId: string;
  title: string;
  description: string;
  progress: number; // 0 - 100
  updatedAt: string;
  members: GroupMember[];
  tasks: GroupTask[];
}

export interface CalendarMark {
  id: string;
  date: string; // "YYYY-MM-DD"
  type: "course" | "ddl" | "exam" | "activity";
  title: string;
  sourceId?: string; // Links DDL CalendarMark directly to assignment.id
  /** Timeline V1：固定时段事件（考试/活动）的开始与结束时间；缺失 = all-day 级别 */
  startTime?: string; // "HH:mm"
  endTime?: string; // "HH:mm"
}

/** Timeline V1：学习计划（我什么时候准备做某个学习任务） */
export interface StudyBlock {
  id: string;
  title: string;
  date: string; // "YYYY-MM-DD"
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
  assignmentId?: string;
  courseId?: string;
  source?: "manual" | "kiro";
}

/** 应用偏好（稳定用户偏好，持久化；Task 2 接入业务模块） */
export interface AppPreferences {
  showWeekends: boolean;
  ddlWarningDays: 1 | 3 | 7;
  defaultDDLTime: string; // "HH:mm"
  enableScheduleDirectManipulation: boolean;
  enableDDLDirectManipulation: boolean;
  motionPreference: "system" | "full" | "reduced";
  /** 启动后进入的默认工作区（last = 上次使用的位置） */
  startupView: StartupView;
  /** 新建任务的默认优先级 */
  defaultTaskPriority: Priority;
  /** 新建任务的默认状态（仅 todo/doing） */
  defaultTaskStatus: DefaultTaskStatus;
  /** 单键快捷键（N/?// 与工作区 J/K/X/Space） */
  enableSingleKeyShortcuts: boolean;
  /** 内容密度（任务工作区 / 课程列表 / 命令中心） */
  contentDensity: ContentDensity;
}

/** 设置中心 section */
export type SettingsSection =
  | "general"
  | "profile"
  | "semester"
  | "tasks"
  | "interaction"
  | "kiro"
  | "data"
  | "about";

/** 备份中的完整业务数据快照 */
export interface ClassFlowBackupData {
  userProfile: UserProfile;
  semester: Semester;
  courses: Course[];
  schedules: CourseSchedule[];
  assignments: Assignment[];
  calendarMarks: CalendarMark[];
  groupProjects: GroupProject[];
  /** Timeline V1：学习计划（旧备份可缺失） */
  studyBlocks?: StudyBlock[];
  /** 应用偏好（v1 旧备份可缺失，导入时回落为当前偏好） */
  preferences?: AppPreferences;
  /** Task 7G-A1：Reminder（旧备份可缺失 → 恢复为 []）；Reminder Preferences 不进入备份 */
  reminders?: Reminder[];
}

/** 本地数据备份文件结构 (v1) */
export interface ClassFlowBackup {
  version: 1;
  exportedAt: string;
  data: ClassFlowBackupData;
}
