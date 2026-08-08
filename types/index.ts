/** 工作区页面 Tab（设置是 Modal Action，不是 Tab） */
export type NavTab =
  | "overview"
  | "timetable"
  | "assignments"
  | "courses"
  | "analytics"
  | "group";

export type TaskFilter = "all" | "doing" | "todo" | "completed";

export type TimeSliceFilter = "all" | "overdue" | "today" | "3days" | "7days" | "completed";

export type Priority = "urgent" | "high" | "medium" | "low";
export type AssignmentStatus = "todo" | "doing" | "submitted" | "completed";

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

export interface Assignment {
  id: string;
  courseId: string;
  title: string;
  description: string;
  ddl: string; // ISO 8601 string, e.g., "2025-05-21T23:59:00.000Z"
  priority: Priority;
  status: AssignmentStatus;
  progress: number; // 0 - 100
  tags: string[];
  subtasks?: Subtask[];
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
}

/** 应用偏好（稳定用户偏好，持久化；Task 2 接入业务模块） */
export interface AppPreferences {
  showWeekends: boolean;
  ddlWarningDays: 1 | 3 | 7;
  defaultDDLTime: string; // "HH:mm"
  enableScheduleDirectManipulation: boolean;
  enableDDLDirectManipulation: boolean;
  motionPreference: "system" | "full" | "reduced";
}

/** 设置中心 section */
export type SettingsSection =
  | "profile"
  | "semester"
  | "tasks"
  | "interaction"
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
  /** 应用偏好（v1 旧备份可缺失，导入时回落为当前偏好） */
  preferences?: AppPreferences;
}

/** 本地数据备份文件结构 (v1) */
export interface ClassFlowBackup {
  version: 1;
  exportedAt: string;
  data: ClassFlowBackupData;
}
