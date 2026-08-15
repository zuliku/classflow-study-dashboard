/**
 * Kiro Write Executor 的受限 API（白名单，禁止 setState）。
 * 单一实现：useKiroChat 的 Tool 执行与 Visual Proposal Apply（executeVisualActionProposal）
 * 共用同一 Adapter Wrapper，避免两套业务 mutation 入口。
 * History source attribution：所有业务 mutation 统一标记 kiro。
 */
import { useAppStore } from "@/store/useAppStore";
import { KiroWriteApi } from "@/lib/ai/tools/write/types";

export interface CreateKiroWriteApiOptions {
  toolCallId: string;
  pushToast: (t: { message: string; actionLabel?: string; onAction?: () => void; type?: "success" | "warning" | "error" | "info" }) => void;
  registerUndo: (toolCallId: string, undo: () => void) => void;
  onCancelOutput: (message: string) => void;
}

export function createKiroWriteApi({
  toolCallId,
  pushToast,
  registerUndo,
  onCancelOutput,
}: CreateKiroWriteApiOptions): KiroWriteApi {
  const s = () => useAppStore.getState();
  const kiro = { source: "kiro" as const };
  return {
    getState: s,
    addAssignment: (a) => useAppStore.getState().addAssignment(a, kiro),
    addAssignmentWithId: (a, id) => useAppStore.getState().addAssignmentWithId(a, id, kiro),
    addScheduleOccurrenceOverride: (o) => useAppStore.getState().addScheduleOccurrenceOverride(o),
    addScheduleOccurrenceOverrideWithId: (o, id) => useAppStore.getState().addScheduleOccurrenceOverrideWithId(o, id),
    deleteScheduleOccurrenceOverride: (id) => useAppStore.getState().deleteScheduleOccurrenceOverride(id),
    restoreScheduleOccurrenceOverride: (o) => useAppStore.getState().restoreScheduleOccurrenceOverride(o),
    updateAssignment: (a) => useAppStore.getState().updateAssignment(a, kiro),
    updateAssignmentPatch: (id, patch) => useAppStore.getState().updateAssignmentPatch(id, patch, kiro),
    deleteAssignment: (id) => useAppStore.getState().deleteAssignment(id, kiro),
    restoreAssignment: (snapshot) => useAppStore.getState().restoreAssignment(snapshot, kiro),
    updateAssignmentStatus: (id, status) => useAppStore.getState().updateAssignmentStatus(id, status, kiro),
    updateAssignmentPriority: (id, priority) => useAppStore.getState().updateAssignmentPriority(id, priority, kiro),
    updateAssignmentProgress: (id, progress) => useAppStore.getState().updateAssignmentProgress(id, progress, kiro),
    toggleSubtask: (id, subtaskId) => useAppStore.getState().toggleSubtask(id, subtaskId, kiro),
    addScheduleSlot: (sl) => useAppStore.getState().addScheduleSlot(sl, kiro),
    updateSchedule: (sc) => useAppStore.getState().updateSchedule(sc, kiro),
    deleteSchedule: (id) => useAppStore.getState().deleteSchedule(id, kiro),
    restoreSchedule: (sc) => useAppStore.getState().restoreSchedule(sc, kiro),
    excludeWeekFromSchedule: (id, week) => useAppStore.getState().excludeWeekFromSchedule(id, week, kiro),
    addCourseWithSchedule: (c, slots) => useAppStore.getState().addCourseWithSchedule(c, slots, kiro),
    updateCourse: (c) => useAppStore.getState().updateCourse(c, kiro),
    addGroupProject: (p) => useAppStore.getState().addGroupProject(p),
    updateGroupProject: (id, patch) => useAppStore.getState().updateGroupProject(id, patch),
    deleteGroupProject: (id) => useAppStore.getState().deleteGroupProject(id),
    addGroupMember: (id, m) => useAppStore.getState().addGroupMember(id, m),
    updateGroupMember: (id, m) => useAppStore.getState().updateGroupMember(id, m),
    deleteGroupMember: (id, memberId) => useAppStore.getState().deleteGroupMember(id, memberId),
    addGroupTask: (id, t) => useAppStore.getState().addGroupTask(id, t),
    updateGroupTask: (id, t) => useAppStore.getState().updateGroupTask(id, t),
    deleteGroupTask: (id, taskId) => useAppStore.getState().deleteGroupTask(id, taskId),
    toggleGroupTask: (id, taskId) => useAppStore.getState().toggleGroupTask(id, taskId),
    addReminder: (input) => useAppStore.getState().addReminder(input),
    updateReminder: (id, patch) => useAppStore.getState().updateReminder(id, patch),
    deleteReminder: (id) => useAppStore.getState().deleteReminder(id),
    restoreReminder: (r) => useAppStore.getState().restoreReminder(r),
    reconcileTargetReminders: (targetType, targetId) =>
      useAppStore.getState().reconcileTargetReminders(targetType, targetId),
    startFocusSession: (input) => useAppStore.getState().startFocusSession(input, kiro),
    pauseFocusSession: (now) => useAppStore.getState().pauseFocusSession(now, kiro),
    resumeFocusSession: (now) => useAppStore.getState().resumeFocusSession(now, kiro),
    finishFocusSession: (now) => useAppStore.getState().finishFocusSession(now, kiro),
    pushToast,
    registerUndo: (id, undo) => registerUndo(id, undo),
  };
}
