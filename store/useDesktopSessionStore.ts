"use client";

import { create } from "zustand";
import type {
  ClassFlowDesktopComputerAppProfileInfo,
  ClassFlowDesktopComputerSessionEvent,
  ClassFlowDesktopComputerSessionStatus,
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
  /** P5：守卫触发原因（sanitized 短句；failed 时展示；绝不透传 raw exception） */
  failureReason: string | null;
  /** P5：terminal surface 的 UI-only dismiss（不持久化；active session 不可 dismiss） */
  dismissedSessionId: string | null;
  /**
   * 后台静默执行指示（Background Computer Use；runtime-only，不持久化）：
   * lib executor 在后台 bridge.action 调用期间置位，结束/异常一律清除。
   * Surface 据此展示常驻“后台执行中”徽标（用户看不见实时界面时的唯一 live 信号）。
   */
  backgroundActive: boolean;
  setBackgroundActive: (active: boolean) => void;
  applyEvent: (event: ClassFlowDesktopComputerSessionEvent) => void;
  setDismissedSessionId: (sessionId: string | null) => void;
  clear: () => void;
}

export const useDesktopSessionStore = create<DesktopSessionUiState>()((set, get) => ({
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
  failureReason: null,
  dismissedSessionId: null,
  backgroundActive: false,
  setBackgroundActive: (active) => set({ backgroundActive: active }),
  applyEvent: (event) => {
    const previousSessionId = get().sessionId;
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
      failureReason: typeof event.failureReason === "string" ? event.failureReason : null,
      // 新 session 必须重新展示 Surface（旧 dismiss 不继承）
      dismissedSessionId: previousSessionId === event.sessionId ? get().dismissedSessionId : null,
    });
  },
  setDismissedSessionId: (sessionId) => set({ dismissedSessionId: sessionId }),
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
    failureReason: null,
    dismissedSessionId: null,
    backgroundActive: false,
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

/**
 * Bridge 返回的完整 status → store event（canonical adapter；pause / resume 等控制路径共用）。
 * 只取 UI 需要字段；绝不写入 native 标识 / 截图。
 */
export function applyDesktopSessionStatus(status: ClassFlowDesktopComputerSessionStatus): void {
  useDesktopSessionStore.getState().applyEvent({
    type: "session",
    sessionId: status.sessionId,
    state: status.state,
    appName: status.appName,
    windowTitle: status.windowTitle,
    actionLabel: status.actionLabel,
    actions: status.actions,
    observations: status.observations,
    updatedAt: status.updatedAt,
    goal: status.goal,
    plan: status.plan,
    stepIndex: status.stepIndex,
    reflectionRequired: status.reflectionRequired,
    appProfile: status.appProfile ?? null,
    failureReason: status.failureReason,
  });
}
