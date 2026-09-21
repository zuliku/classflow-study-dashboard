"use client";

import { create } from "zustand";
import type {
  ClassFlowDesktopComputerAppProfileInfo,
  ClassFlowDesktopComputerSessionEvent,
  DesktopControlSessionState,
} from "@/lib/desktop/types";

/**
 * Desktop Control Session UI Store（Sidecar 状态卡；runtime-only，不持久化）。
 * 只保存脱敏事件字段：sessionId / state / appName / windowTitle / actionLabel / 计数。
 * 绝不保存截图 / native 标识 / 输入内容。
 */
export interface DesktopSessionUiState {
  sessionId: string | null;
  state: DesktopControlSessionState | null;
  appName: string | null;
  windowTitle: string | null;
  actionLabel: string | null;
  actions: number;
  observations: number;
  updatedAt: number;
  /** V2.3：目标 / 计划 / 当前步骤 / 反思状态（Sidecar 时间线） */
  goal: string | null;
  plan: string[];
  stepIndex: number;
  reflectionRequired: boolean;
  /** V2.4：当前应用画像（已脱敏 label / blocked） */
  appProfile: ClassFlowDesktopComputerAppProfileInfo | null;
  applyEvent: (event: ClassFlowDesktopComputerSessionEvent) => void;
  clear: () => void;
}

export const useDesktopSessionStore = create<DesktopSessionUiState>()((set) => ({
  sessionId: null,
  state: null,
  appName: null,
  windowTitle: null,
  actionLabel: null,
  actions: 0,
  observations: 0,
  updatedAt: 0,
  goal: null,
  plan: [],
  stepIndex: 0,
  reflectionRequired: false,
  appProfile: null,
  applyEvent: (event) =>
    set({
      sessionId: event.sessionId,
      state: event.state,
      appName: event.appName,
      windowTitle: event.windowTitle,
      actionLabel: event.actionLabel,
      actions: event.actions,
      observations: event.observations,
      updatedAt: event.updatedAt,
      goal: event.goal ?? null,
      plan: Array.isArray(event.plan) ? event.plan : [],
      stepIndex: typeof event.stepIndex === "number" ? event.stepIndex : 0,
      reflectionRequired: event.reflectionRequired === true,
      appProfile: event.appProfile ?? null,
    }),
  clear: () =>
    set({
      sessionId: null,
      state: null,
      appName: null,
      windowTitle: null,
      actionLabel: null,
      actions: 0,
      observations: 0,
      updatedAt: 0,
      goal: null,
      plan: [],
      stepIndex: 0,
      reflectionRequired: false,
      appProfile: null,
    }),
}));

/** 非终态（正在进行的 session） */
export function isActiveDesktopSessionState(state: DesktopControlSessionState | null): boolean {
  return (
    state === "idle" ||
    state === "observing" ||
    state === "acting" ||
    state === "waiting" ||
    state === "approval-required" ||
    state === "paused"
  );
}
