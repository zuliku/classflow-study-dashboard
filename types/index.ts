export type Priority = 'urgent' | 'high' | 'medium' | 'low';
export type AssignmentStatus = 'todo' | 'doing' | 'submitted' | 'completed';

export interface CourseMaterial {
  id: string;
  title: string;
  type: 'pdf' | 'ppt' | 'doc' | 'link';
  size?: string;
  url?: string;
  uploadDate: string;
}

export interface Course {
  id: string;
  name: string;
  code: string;
  teacher: string;
  classroom: string;
  credit: number;
  bgHex: string;     // e.g. '#E3E6E0' (Pastel Mint)
  borderHex: string; // e.g. '#CCCBC4'
  textHex: string;   // e.g. '#313032'
  description?: string;
  materials: CourseMaterial[];
}

export interface CourseSchedule {
  id: string;
  courseId: string;
  dayOfWeek: number; // 1 (Mon) - 7 (Sun)
  startTime: string; // "08:00"
  endTime: string;   // "09:40"
  location: string;
  weeks: string;     // e.g., "1-16周", "1-8周", "单周", "双周"
  activeWeeks?: number[]; // list of active week numbers e.g. [1,2,3,4,5,6,7,8]
  excludedWeeks?: number[]; // list of excluded week numbers (single week cancellation) e.g. [5]
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
  description?: string;
  ddl: string; // ISO string format
  priority: Priority;
  status: AssignmentStatus;
  progress: number; // 0-100
  tags?: string[];
  subtasks?: Subtask[];
}

export interface CalendarMark {
  id: string;
  date: string; // "YYYY-MM-DD"
  type: 'course' | 'ddl' | 'exam' | 'activity';
  title: string;
}

export interface UserProfile {
  name: string;
  avatarUrl: string;
  college: string;
  grade: string;
  studentId: string;
  completedCredits: number;
  totalCredits: number;
}

export interface GroupMember {
  id: string;
  name: string;
  avatarUrl: string;
  role: 'leader' | 'member';
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
  progress: number;
  members: GroupMember[];
  tasks: GroupTask[];
  updatedAt: string;
}

export interface ScheduleConflict {
  scheduleA: CourseSchedule;
  scheduleB: CourseSchedule;
  dayOfWeek: number;
  timeRange: string;
}
