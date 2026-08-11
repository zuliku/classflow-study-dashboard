import {
  Assignment,
  Course,
  CourseSchedule,
  GroupMember,
  GroupTask,
  Priority,
} from "@/types";
import type { AppState } from "@/store/useAppStore";
import { DeleteResult } from "@/lib/assignmentActions";
/** 写操作风险等级：risk 由 ClassFlow 决定，模型不得影响 */
export type KiroWriteRisk = "normal" | "destructive";

export const KIRO_WRITE_RISKS: Record<string, KiroWriteRisk> = {
  create_assignment: "normal",
  update_assignment: "normal",
  set_assignment_ddl: "normal",
  set_assignment_priority: "normal",
  set_assignment_status: "normal",
  set_assignment_progress: "normal",
  toggle_assignment_subtask: "normal",
  delete_assignment: "destructive",
  create_schedule: "normal",
  move_schedule: "normal",
  resize_schedule: "normal",
  update_schedule: "normal",
  exclude_schedule_week: "normal",
  delete_schedule: "destructive",
  create_course: "normal",
  update_course: "normal",
  create_group_project: "normal",
  update_group_project: "normal",
  add_group_member: "normal",
  update_group_member: "normal",
  create_group_task: "normal",
  update_group_task: "normal",
  assign_group_task: "normal",
  set_group_task_ddl: "normal",
  toggle_group_task: "normal",
  // Task 7G-B：Reminder 操作均 normal（UI 删除同为直接删除，且有 Undo；不触发 destructive 确认）
  create_reminder: "normal",
  update_reminder: "normal",
  delete_reminder: "normal",
  // Task 5：Focus 操作均 normal（不弹 ConfirmDialog；无 Undo）
  start_focus_session: "normal",
  pause_focus_session: "normal",
  resume_focus_session: "normal",
  finish_focus_session: "normal",
};

export function isDestructiveWriteTool(toolName: string): boolean {
  return KIRO_WRITE_RISKS[toolName] === "destructive";
}

/** 写工具统一结果 envelope */
export type WriteToolResult<T = unknown> =
  | {
      ok: true;
      data: T;
      action: {
        tool: string;
        entityType:
          | "assignment"
          | "schedule"
          | "course"
          | "group-project"
          | "group-member"
          | "group-task"
          | "change-set"
          | "memory"
          | "reminder"
          | "focus-session";
        entityId: string;
        title: string;
        operation: "create" | "update" | "delete";
        before?: unknown;
        after?: unknown;
        canUndo: boolean;
        /** Change Set（apply_change_set）：整体结果摘要 */
        changeSet?: {
          count: number;
          summary: string;
          actions: {
            tool: string;
            entityType: string;
            entityId: string;
            title: string;
            operation: string;
            before?: unknown;
            after?: unknown;
          }[];
        };
      };
    }
  | {
      ok: false;
      code:
        | "NOT_FOUND"
        | "INVALID_INPUT"
        | "AMBIGUOUS"
        | "CONFLICT"
        | "LAST_LEADER"
        | "USER_CANCELLED"
        | "UNSUPPORTED"
        | "EXECUTION_FAILED"
        | "TRANSACTION_PREFLIGHT_FAILED"
        | "TRANSACTION_REPREFLIGHT_FAILED"
        | "TRANSACTION_CONTRADICTORY"
        | "TRANSACTION_INTEGRITY"
        | "TRANSACTION_TOO_LARGE"
        | "EXPLICIT_MEMORY_INTENT_REQUIRED"
        | "MEMORY_SENSITIVE_CONTENT"
        | "MEMORY_LIMIT_REACHED"
        | "MEMORY_DISABLED"
        | "FOCUS_SESSION_ALREADY_ACTIVE"
        | "NO_ACTIVE_FOCUS_SESSION"
        | "FOCUS_ALREADY_PAUSED"
        | "FOCUS_NOT_PAUSED"
        | "INVALID_FOCUS_DURATION"
        | "FOCUS_TARGET_NOT_FOUND"
        | "FOCUS_TARGET_MISMATCH";
      message: string;
      details?: unknown;
      /** 事务失败时的实际写入数（Preflight / Rollback 后恒为 0） */
      applied?: number;
      /** 事务失败时的首个失败操作下标（Change Set 用） */
      failedActionIndex?: number;
    };

/** Undo 一次性条目 */
export interface KiroUndoEntry {
  toolCallId: string;
  used: boolean;
  undo: () => void;
}

/**
 * Kiro Write Executor 的受限 API：
 * 只暴露白名单 action，禁止 setState / 任意 JS。
 */
export interface KiroWriteApi {
  getState: () => AppState;

  addAssignment: (a: Omit<Assignment, "id">) => string;
  updateAssignment: (a: Assignment) => void;
  /** Task V2 字段级 patch（DDL CalendarMark 三态同步由 Store 统一处理；ddl 缺省 = 不改变） */
  updateAssignmentPatch: (id: string, patch: Partial<Omit<Assignment, "id">>) => void;
  deleteAssignment: (id: string) => DeleteResult | null;
  restoreAssignment: (snapshot: DeleteResult) => void;
  updateAssignmentStatus: (id: string, status: Assignment["status"]) => void;
  updateAssignmentPriority: (id: string, priority: Priority) => void;
  updateAssignmentProgress: (id: string, progress: number) => void;
  toggleSubtask: (assignmentId: string, subtaskId: string) => void;

  addScheduleSlot: (s: Omit<CourseSchedule, "id">) => string;
  updateSchedule: (s: CourseSchedule) => void;
  deleteSchedule: (id: string) => CourseSchedule | null;
  restoreSchedule: (s: CourseSchedule) => void;
  excludeWeekFromSchedule: (scheduleId: string, week: number) => void;

  addCourseWithSchedule: (
    c: Omit<Course, "id" | "materials">,
    slots: Omit<CourseSchedule, "id" | "courseId">[]
  ) => string;
  updateCourse: (c: Course) => void;

  addGroupProject: (p: { courseId: string; title: string; description?: string }) => string;
  updateGroupProject: (projectId: string, patch: { title?: string; description?: string }) => void;
  deleteGroupProject: (projectId: string) => void;
  addGroupMember: (
    projectId: string,
    m: { name: string; role?: GroupMember["role"]; major?: string; avatarUrl?: string }
  ) => string;
  updateGroupMember: (projectId: string, m: GroupMember) => void;
  deleteGroupMember: (
    projectId: string,
    memberId: string
  ) => { ok: boolean; reason?: string };
  addGroupTask: (
    projectId: string,
    t: { title: string; assigneeId?: string; ddl: string }
  ) => string;
  updateGroupTask: (projectId: string, t: GroupTask) => void;
  deleteGroupTask: (projectId: string, taskId: string) => void;
  toggleGroupTask: (projectId: string, taskId: string) => void;

  // Task 7G-A1/B：Reminder 白名单
  addReminder: AppState["addReminder"];
  updateReminder: AppState["updateReminder"];
  deleteReminder: AppState["deleteReminder"];
  /** Undo 精确恢复原 Reminder（相同 ID，不重新生成） */
  restoreReminder: AppState["restoreReminder"];
  reconcileTargetReminders: AppState["reconcileTargetReminders"];

  // Task 5：Focus Session 白名单（canUndo=false；不暴露 setState）
  startFocusSession: AppState["startFocusSession"];
  pauseFocusSession: AppState["pauseFocusSession"];
  resumeFocusSession: AppState["resumeFocusSession"];
  finishFocusSession: AppState["finishFocusSession"];

  pushToast: (t: {
    message: string;
    actionLabel?: string;
    onAction?: () => void;
    type?: "success" | "warning" | "error" | "info";
  }) => void;
  /** 注册一次性 Undo */
  registerUndo: (toolCallId: string, undo: () => void) => void;
}
