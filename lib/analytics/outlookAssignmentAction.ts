/**
 * Workflow UX V13：Study Outlook task → 全局 Assignment Drawer 的 navigation action。
 * 独立轻模块（不拖入 Analytics 图谱）：LearningAnalyticsView 持有 ownership 并传入
 * StudyOutlookCard.onOpenAssignment；本函数只做 click-time fresh Store 校验 + 写全局 selection。
 *
 * - fresh Store 校验：Outlook 是异步重建的 snapshot，渲染后到点击之间 Assignment
 *   可能已被删除/修改——stale id 不写入 selectedAssignmentId（no-op，无噪声 Toast）
 * - 只写 selectedAssignmentId：Drawer 是 overlay；关闭后仍停留在当前 Analytics context
 *   （horizon / 滚动位置 / preset 全部不动；绝不 setActiveTab）
 */
import { useAppStore } from "@/store/useAppStore";

export function handleOpenOutlookAssignment(assignmentId: string): boolean {
  const fresh = useAppStore.getState();
  if (!fresh.assignments.some((a) => a.id === assignmentId)) return false;
  fresh.setSelectedAssignmentId(assignmentId);
  return true;
}
