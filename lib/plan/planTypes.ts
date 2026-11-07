import type { TaskProjectionItem } from "@/lib/tasks/taskProjections";

/** Plan 画布上的统一实体。所有 timed 实体共享同一垂直时间轴。 */
export type PlanCanvasItemKind = "course" | "study" | "exam" | "activity" | "ddl";

export interface PlanCanvasItem {
  id: string;
  kind: PlanCanvasItemKind;
  title: string;
  subtitle?: string;
  date: string;
  start: number;
  end: number;
  courseId?: string;
  assignmentId?: string;
  blockId?: string;
  markId?: string;
  color?: string;
  textColor?: string;
  /** 课程发生时间（用于 Inspector 课程摘要） */
  location?: string;
}

export interface PlanAllDayItem {
  id: string;
  kind: PlanCanvasItemKind;
  title: string;
  date: string;
  courseId?: string;
  assignmentId?: string;
  markId?: string;
}

export interface PlanDay {
  date: string;
  dateObj: Date;
  dayOfWeek: number;
  isToday: boolean;
  items: PlanCanvasItem[];
  allDay: PlanAllDayItem[];
}

export type PlanSelection =
  | { kind: "assignment"; assignmentId: string }
  | {
      kind: "course";
      courseId: string;
      date: string;
      startTime: string;
      endTime: string;
      location?: string;
    }
  | { kind: "block"; blockId: string }
  | { kind: "mark"; markId: string };

export type PlanBacklogGroupId = "overdue" | "dueThisWeek" | "needsScheduling";

export interface PlanBacklogGroup {
  id: PlanBacklogGroupId;
  title: string;
  items: TaskProjectionItem[];
}
