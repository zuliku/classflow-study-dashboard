/**
 * Timeline V1：统一展示模型（Display Model）。
 * Source of Truth 仍是各 Domain Model（CourseSchedule / Assignment / GroupTask / CalendarMark / StudyBlock）。
 */

export type TimelineSourceType =
  | "course"
  | "assignment"
  | "group-task"
  | "exam"
  | "activity"
  | "study-block";

export type TimelineTemporalType =
  | "fixed" // Course：Hour Grid 中的固定课程块
  | "deadline" // 截止时间点
  | "interval" // 考试 / 活动等固定时段
  | "flexible" // StudyBlock：弱时间块
  | "all-day"; // 只有日期的事件（不伪造具体时间）

export interface TimelineItem {
  id: string;
  sourceId: string;
  sourceType: TimelineSourceType;
  temporalType: TimelineTemporalType;
  title: string;
  /** "YYYY-MM-DD" */
  date: string;
  startTime?: string; // "HH:mm"
  endTime?: string; // "HH:mm"
  courseId?: string;
  priority?: "urgent" | "high" | "medium" | "low";
  /** 副信息（hover 详情；如地点 / 课程名） */
  subtitle?: string;
  /** 独立 CalendarMark 的 mark id（P3 fix 4：ddl mark 的 per-target 提醒控制定位；assignment item 无此字段） */
  calendarMarkId?: string;
}
