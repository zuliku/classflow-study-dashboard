/**
 * Schedule Import Core — 共享类型。
 *
 * 手动导入（ICS/CSV/JSON）与 Vision 课表导入共用同一套中间表示、
 * 重复/冲突检测、preflight 与指纹，保证行为一致、不复制第二套逻辑。
 */

/** 上课节次模板（Bell Schedule）：节次号 → 具体时间。 */
export interface BellPeriod {
  period: number;
  startTime: string; // "HH:mm"
  endTime: string;
}

export interface BellScheduleTemplate {
  id: string;
  name: string;
  periods: BellPeriod[];
}

/** 课程草稿（本导入内部） */
export interface ImportableCourseDraft {
  /** 本次导入内部关联 key（非持久化 ID） */
  draftKey: string;
  name: string;
  code?: string;
  teacher?: string;
  classroom?: string;
  credit?: number;
  slots: ImportableSlotDraft[];
}

/** 上课时段草稿：节次（period）或已确定时间（startTime/endTime）二选一 */
export interface ImportableSlotDraft {
  dayOfWeek: number; // 1-7（1=周一）
  /** 节次（如 1、3、7）；与 startTime 互斥，需 Bell Schedule 解析 */
  periodStart?: number;
  periodEnd?: number;
  /** 已确定时间（手动导入/已修正） */
  startTime?: string;
  endTime?: string;
  /** 周次表达式（空 → 默认全学期 "1-16周"） */
  weekExpression?: string;
  location?: string;
  /** Vision 依据（最短必要事实；不进持久化数据） */
  evidence?: string;
}

/** Preflight 后解析出的可导入时段 */
export interface ResolvedImportSlot {
  /** 对应原始 draft slot 下标（非法 slot 被过滤后仍能正确定位；不写入持久化数据） */
  sourceSlotIndex: number;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  weekExpression: string;
  location?: string;
}

/** Preflight 后解析出的可导入课程（draftKey → 关联草稿） */
export interface ResolvedCourseImport {
  draftKey: string;
  name: string;
  code?: string;
  teacher?: string;
  classroom?: string;
  credit?: number;
  slots: ResolvedImportSlot[];
}

export type ImportIssueCode =
  | "missing-period-template"
  | "missing-information"
  | "invalid-week-expression"
  | "ambiguous-cell"
  | "duplicate-course"
  | "schedule-conflict"
  | "unsupported-layout";

export interface ImportIssue {
  code: ImportIssueCode;
  severity: "blocker" | "warning";
  /** 关联课程 draftKey（可空） */
  courseKey?: string;
  /** 关联 slot 下标（可空） */
  slotIndex?: number;
  message: string;
}
