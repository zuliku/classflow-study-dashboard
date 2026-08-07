export type NavTab =
  | "overview"
  | "timetable"
  | "assignments"
  | "courses"
  | "analytics"
  | "group"
  | "settings";

export type ViewMode = "day" | "week" | "month";

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
  type: "pdf" | "ppt" | "doc" | "link";
  size?: string;
  uploadDate: string;
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
  avatarUrl: string;
  role: "leader" | "member";
  major: string;
}

export interface GroupTask {
  id: string;
  title: string;
  assigneeName: string;
  assigneeAvatar: string;
  ddl: string;
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

/** 备份中的完整业务数据快照 */
export interface ClassFlowBackupData {
  userProfile: UserProfile;
  semester: Semester;
  courses: Course[];
  schedules: CourseSchedule[];
  assignments: Assignment[];
  calendarMarks: CalendarMark[];
  groupProjects: GroupProject[];
}

/** 本地数据备份文件结构 (v1) */
export interface ClassFlowBackup {
  version: 1;
  exportedAt: string;
  data: ClassFlowBackupData;
}
