/**
 * Kiro Long-term Learning Memory（Task 9）。
 * 明确分离：History（用户说过什么）≠ Summary（长对话压缩）≠ Memory（用户要求跨会话记住的稳定偏好）。
 * V1 只支持 Explicit Memory：仅当用户明确表达「记住 / 以后都… / 我的偏好是…」等意图时保存。
 */

export type MemoryCategory =
  | "study-habit"
  | "schedule-preference"
  | "priority-preference"
  | "learning-goal"
  | "course-preference"
  | "constraint"
  | "other";

export type MemoryScope = "global" | "semester" | "course";

export interface KiroMemory {
  id: string;
  title: string;
  content: string;
  category: MemoryCategory;
  scope: MemoryScope;
  /** scope === "semester" → semester.id；scope === "course" → courseId */
  scopeId?: string;
  tags?: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export const MEMORY_CATEGORY_LABELS: Record<MemoryCategory, string> = {
  "study-habit": "学习习惯",
  "schedule-preference": "安排偏好",
  "priority-preference": "优先级",
  "learning-goal": "学习目标",
  "course-preference": "课程偏好",
  constraint: "约束",
  other: "其他",
};

export const MEMORY_SCOPE_LABELS: Record<MemoryScope, string> = {
  global: "全局",
  semester: "学期",
  course: "课程",
};

/** V1 上限 */
export const MAX_MEMORIES = 50;
export const MAX_MEMORY_TITLE = 60;
export const MAX_MEMORY_CONTENT = 500;
export const MAX_MEMORY_TAGS = 5;
export const MAX_MEMORY_SEARCH_RESULTS = 10;
