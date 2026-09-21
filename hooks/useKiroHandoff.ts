"use client";

import { useKiroSession, useOptionalKiroSession } from "@/components/kiro/KiroSessionProvider";
import type { KiroSessionValue } from "@/components/kiro/KiroSessionProvider";

/**
 * Kiro Handoff API（业务 UI 唯一入口）：业务组件不需要知道 Kiro Runtime 内部结构。
 *
 * - `useKiroHandoff()`：需要 Kiro 会话的组件（缺 Provider 属于真实错误）。
 * - `useOptionalKiroHandoff()`：全局 Overlay / 搜索等「没有 Kiro 也要能用」的入口；
 *   Provider 暂不可用时返回 null（调用方降级），避免整个应用被一个可选功能拖垮。
 */
export interface KiroHandoffApi {
  openForAssignment: KiroSessionValue["openForAssignment"];
  openForCourse: KiroSessionValue["openForCourse"];
  openForGroupProject: KiroSessionValue["openForGroupProject"];
  openForWeek: KiroSessionValue["openForWeek"];
  handoffPrompt: KiroSessionValue["handoffPrompt"];
  handoffAssignmentPrompt: KiroSessionValue["handoffAssignmentPrompt"];
}

function toHandoffApi(session: KiroSessionValue): KiroHandoffApi {
  return {
    openForAssignment: session.openForAssignment,
    openForCourse: session.openForCourse,
    openForGroupProject: session.openForGroupProject,
    openForWeek: session.openForWeek,
    handoffPrompt: session.handoffPrompt,
    handoffAssignmentPrompt: session.handoffAssignmentPrompt,
  };
}

export function useKiroHandoff(): KiroHandoffApi {
  return toHandoffApi(useKiroSession());
}

export function useOptionalKiroHandoff(): KiroHandoffApi | null {
  const session = useOptionalKiroSession();
  return session ? toHandoffApi(session) : null;
}
