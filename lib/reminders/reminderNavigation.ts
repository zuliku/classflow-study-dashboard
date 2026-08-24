/**
 * Workflow UX V16：Reminder → Exact Target Navigation（唯一 canonical routing）。
 *
 * Runtime（Browser Notification click）/ ReminderViewport（站内 Card）/ ReminderCenter
 * 三处 surface 一律调用本 helper——禁止各自再写 targetType switch。
 *
 * 规则：
 * - Fresh Store：点击时刻 useAppStore.getState() 重新解析 target
 *   （交付到点击之间实体可能被删除 / 移动 / released）
 * - assignment → setSelectedAssignmentId（Global Drawer owner；不切 Workspace，
 *   关闭后回到原上下文）
 * - studyBlock → openTimelineAtDate 精确周；学期外且存在 parent Assignment →
 *   打开 Assignment（安全降级）；standalone 学期外 → no-op（不 clamp、不虚构实体）。
 *   released block 是 non-blocking historical plan，仍可导航（历史 fired reminder 查看）。
 * - calendarMark：sourceId 指向真实 Assignment → Assignment owner（linked DDL 的
 *   canonical Detail）；否则 Independent → setSelectedCalendarMarkId + 尝试精确周
 *   （学期外仅打开 Drawer，week/tab 保持原值，不 clamp）
 * - standalone → 交给 caller 注入的 onStandalone（Runtime/Viewport 开 Center；
 *   Center 内部为 scheduled 编辑 / 历史只读），helper 不依赖 UI Center store
 *
 * mark-read 由 caller 在调用本 helper 前完成——导航失败不影响 read semantics。
 */

import { Reminder } from "@/types";
import { useAppStore } from "@/store/useAppStore";
import { canOpenTimelineAtDate, openTimelineAtDate } from "@/lib/timeline/openTimelineAtDate";

export type ReminderNavigationResult =
  | "assignment"
  | "study-block"
  | "calendar-mark"
  | "fallback-assignment"
  | "standalone"
  | "stale"
  | "out-of-semester";

export interface NavigateReminderTargetDeps {
  /** entity 目标导航开始前的 caller 副作用（如 ReminderCenter close 自身） */
  onBeforeEntityNavigate?: () => void;
  /** standalone reminder 处理（由 caller 注入，避免 Domain 依赖 UI Center store） */
  onStandalone?: (reminder: Reminder) => void;
}

export function navigateReminderTarget(
  reminder: Reminder,
  deps: NavigateReminderTargetDeps = {}
): ReminderNavigationResult {
  const state = useAppStore.getState();

  if (reminder.targetType === "assignment") {
    deps.onBeforeEntityNavigate?.();
    const assignment = state.assignments.find((a) => a.id === reminder.targetId);
    if (!assignment) return "stale"; // 不写 stale selection、不开 blank Drawer
    state.setSelectedAssignmentId(assignment.id);
    return "assignment";
  }

  if (reminder.targetType === "studyBlock") {
    deps.onBeforeEntityNavigate?.();
    const block = state.studyBlocks.find((b) => b.id === reminder.targetId);
    if (!block) return "stale";
    // released block 是历史计划而非 deleted entity：仍可查看所在周
    if (canOpenTimelineAtDate(block.date, state.semester)) {
      openTimelineAtDate({
        date: block.date,
        semester: state.semester,
        setCurrentSemesterWeek: state.setCurrentSemesterWeek,
        setActiveTab: state.setActiveTab,
      });
      return "study-block";
    }
    // 学期外：不 clamp。有 parent Assignment → 至少打开 Assignment Detail
    if (block.assignmentId && state.assignments.some((a) => a.id === block.assignmentId)) {
      state.setSelectedAssignmentId(block.assignmentId);
      return "fallback-assignment";
    }
    return "out-of-semester"; // standalone 学期外：no-op
  }

  if (reminder.targetType === "calendarMark") {
    deps.onBeforeEntityNavigate?.();
    const mark = state.calendarMarks.find((m) => m.id === reminder.targetId);
    if (!mark) return "stale";
    // linked DDL：canonical Detail owner 是 Assignment（不重新分叉到 CalendarMark Drawer）
    if (
      mark.sourceId &&
      state.assignments.some((a) => a.id === mark.sourceId)
    ) {
      state.setSelectedAssignmentId(mark.sourceId);
      return "assignment";
    }
    // stale sourceId（指向不存在 Assignment）：mark 本身仍在 → 按 Independent 处理，不 no-op
    // Independent：exact entity → exact workspace position（学期外仅开 Drawer，不 clamp）
    state.setSelectedCalendarMarkId(mark.id);
    if (openTimelineAtDate({
      date: mark.date,
      semester: state.semester,
      setCurrentSemesterWeek: state.setCurrentSemesterWeek,
      setActiveTab: state.setActiveTab,
    })) {
      return "calendar-mark";
    }
    return "out-of-semester";
  }

  // standalone：caller 注入处理（保持既有语义）
  deps.onStandalone?.(reminder);
  return "standalone";
}
