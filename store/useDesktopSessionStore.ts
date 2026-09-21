"use client";

import { create } from "zustand";
import type {
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
