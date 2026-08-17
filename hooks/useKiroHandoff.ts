"use client";

import { useKiroSession } from "@/components/kiro/KiroSessionProvider";

/**
 * Kiro Handoff API（业务 UI 唯一入口）：
 * 业务组件不需要知道 Kiro Runtime 内部结构。
 */
export function useKiroHandoff() {
  const session = useKiroSession();
  return {
    openForAssignment: session.openForAssignment,
    openForCourse: session.openForCourse,
    openForGroupProject: session.openForGroupProject,
    openForWeek: session.openForWeek,
    handoffPrompt: session.handoffPrompt,
    handoffAssignmentPrompt: session.handoffAssignmentPrompt,
  };
}
