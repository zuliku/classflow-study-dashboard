import { Assignment, CalendarMark, Priority } from "@/types";
import {
  bulkApplyDDLDate,
  bulkApplyPriority,
  bulkApplyStatus,
} from "@/lib/assignmentSelection";
import { openAssignmentEditor } from "@/lib/uiEvents";

export interface DeleteResult {
  assignment: Assignment;
  marks: CalendarMark[];
}

/** Command Registry 与 Context Menu / Bulk Bar 共用的赋值动作集合 */
export interface AssignmentActions {
  openDrawer: (id: string) => void;
  editDrawer: (id: string) => void;
  markCompleted: (ids: string[]) => void;
  markDoing: (ids: string[]) => void;
  setPriority: (ids: string[], priority: Priority) => void;
  setDDLDate: (ids: string[], targetDate: string) => void;
  remove: (ids: string[]) => void;
}

export interface AssignmentActionApi {
  getAssignments: () => Assignment[];
  updateAssignment: (a: Assignment) => void;
  setSelectedAssignmentId: (id: string | null) => void;
  deleteAssignment: (id: string) => DeleteResult | null;
  restoreAssignment: (assignment: Assignment, marks: CalendarMark[]) => void;
  pushToast: (toast: {
    message: string;
    actionLabel?: string;
    onAction?: () => void;
    type?: "success" | "warning" | "error" | "info";
  }) => void;
  confirm?: (request: {
    title: string;
    description: string;
    confirmLabel: string;
    danger?: boolean;
    onConfirm: () => void;
  }) => void;
}

/**
 * 批量动作工厂（唯一实现，Command Center / Context Menu / Bulk Bar 共用）：
 * - 状态/优先级/DDL：按 id 取当前任务，用纯函数构造新对象后逐项 updateAssignment
 *   （同一 id，CalendarMark 由 store 的 updateAssignment 自动同步）
 * - 删除：deleteAssignment 收集 assignment+marks，经 ConfirmDialog 确认后执行；
 *   Toast 撤销时 restoreAssignment 完整恢复（Assignment + CalendarMark + sourceId）
 */
export function createAssignmentActions(api: AssignmentActionApi): AssignmentActions {
  const {
    getAssignments,
    updateAssignment,
    setSelectedAssignmentId,
    deleteAssignment,
    restoreAssignment,
    pushToast,
  } = api;

  const targets = (ids: string[]): Assignment[] =>
    getAssignments().filter((a) => ids.includes(a.id));

  const remove = (ids: string[]) => {
    if (ids.length === 0) return;
    const doDelete = () => {
      const removed = ids
        .map((id) => deleteAssignment(id))
        .filter((r): r is DeleteResult => r != null);
      pushToast({
        message: `${removed.length} 项任务已删除`,
        actionLabel: "撤销",
        onAction: () => {
          removed.forEach((r) => restoreAssignment(r.assignment, r.marks));
        },
      });
    };
    if (api.confirm) {
      api.confirm({
        title: `删除 ${ids.length} 项任务？`,
        description: "任务、相关日历标记与本地数据将一并删除，此操作无法撤销。",
        confirmLabel: "删除任务",
        danger: true,
        onConfirm: doDelete,
      });
    } else {
      doDelete();
    }
  };

  return {
    openDrawer: (id) => setSelectedAssignmentId(id),
    editDrawer: (id) => {
      // 统一事件入口（lib/uiEvents），不手写事件名
      openAssignmentEditor({ assignmentId: id });
    },
    markCompleted: (ids) => bulkApplyStatus(targets(ids), "completed").forEach(updateAssignment),
    markDoing: (ids) => bulkApplyStatus(targets(ids), "doing").forEach(updateAssignment),
    setPriority: (ids, priority) => bulkApplyPriority(targets(ids), priority).forEach(updateAssignment),
    setDDLDate: (ids, targetDate) => bulkApplyDDLDate(targets(ids), targetDate).forEach(updateAssignment),
    remove,
  };
}
