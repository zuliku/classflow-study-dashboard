"use client";

import React, { useEffect } from "react";
import { Pause, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { getClassFlowDesktopComputerSessionBridge } from "@/lib/desktop/bridge";
import { useDesktopSessionStore, isActiveDesktopSessionState } from "@/store/useDesktopSessionStore";

/** Main 侧动作标签 → 人类可读状态文案（Sidecar） */
function describeState(input: {
  state: string | null;
  appName: string | null;
  windowTitle: string | null;
  actionLabel: string | null;
  failureReason?: string | null;
}): string {
  const app = input.appName || input.windowTitle || "桌面";
  switch (input.state) {
    case "observing":
      return `正在查看 ${app}`;
    case "acting": {
      const label = input.actionLabel ?? "";
      const prefix = label.startsWith("wait")
        ? "正在等待"
        : label.startsWith("window:activate")
          ? "正在切换窗口"
          : label.startsWith("app:open")
            ? "正在打开应用"
            : label.startsWith("click")
              ? "正在点击"
              : label.startsWith("double_click")
                ? "正在双击"
                : label.startsWith("type")
                  ? "正在输入"
                  : label.startsWith("key")
                    ? "正在按键"
                    : label.startsWith("scroll")
                      ? "正在滚动"
                      : label.startsWith("focus")
                        ? "正在聚焦"
                        : "正在操作界面";
      return `${prefix} · ${app}`;
    }
    case "waiting":
      return `正在等待界面响应 · ${app}`;
    case "approval-required":
      return "等待你的确认";
    case "paused":
      return "已暂停";
    case "completed":
      return "已完成";
    case "failed":
      return "已停止（未继续自动尝试）";
    case "cancelled":
      return "已停止";
    default:
      return `正在使用 ${app}`;
  }
}

/**
 * Computer Session 状态卡（Phase 3 Sidecar UX）：
 * - 始终显示 Kiro 当前在操作什么（正在查看 / 正在点击 / 等待确认…）
 * - Pause / Resume / Stop；Stop 最高优先级（派发 classflow:computer:stop → useKiroChat 统一 Stop）
 */
export function KiroComputerSessionCard() {
  const sessionId = useDesktopSessionStore((s) => s.sessionId);
  const state = useDesktopSessionStore((s) => s.state);
  const appName = useDesktopSessionStore((s) => s.appName);
  const windowTitle = useDesktopSessionStore((s) => s.windowTitle);
  const actionLabel = useDesktopSessionStore((s) => s.actionLabel);
  const actions = useDesktopSessionStore((s) => s.actions);

  // 订阅 Main session 事件（仅 Desktop Runtime；Web 版永不出现）
  useEffect(() => {
    const bridge = getClassFlowDesktopComputerSessionBridge();
    if (!bridge) return;
    const unsubscribe = bridge.subscribeSession((event) => {
      useDesktopSessionStore.getState().applyEvent(event);
    });
    return unsubscribe;
  }, []);

  if (!sessionId || !state) return null;
  if (state === "idle" && actions === 0) return null;

  const active = isActiveDesktopSessionState(state);
  const paused = state === "paused";

  const handlePause = () => {
    const bridge = getClassFlowDesktopComputerSessionBridge();
    if (!bridge || !sessionId) return;
    void bridge.pauseSession({ sessionId }).then((status) => {
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
      });
    }).catch(() => undefined);
  };

  const handleResume = () => {
    const bridge = getClassFlowDesktopComputerSessionBridge();
    if (!bridge || !sessionId) return;
    void bridge.resumeSession({ sessionId }).then((status) => {
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
      });
    }).catch(() => undefined);
  };

  const handleStop = () => {
    // Stop 最高优先级：由 useKiroChat 统一处理（取消 session + 停止当前 turn）
    window.dispatchEvent(new CustomEvent("classflow:computer:stop"));
  };

  return (
    <div
      data-testid="kiro-computer-session-card"
      data-state={state}
      className="mx-3 mt-2 rounded-xl border border-line bg-white/80 px-3 py-2 flex items-center gap-2 shrink-0"
    >
      <span
        aria-hidden="true"
        className={
          state === "approval-required" || state === "paused"
            ? "w-1.5 h-1.5 rounded-full bg-danger shrink-0"
            : active
              ? "w-1.5 h-1.5 rounded-full bg-pastel-mint shrink-0 animate-pulse"
              : "w-1.5 h-1.5 rounded-full bg-sandrift shrink-0"
        }
      />
      <p className="text-[11px] font-semibold text-charcoal truncate flex-1 min-w-0">
        {describeState({ state, appName, windowTitle, actionLabel })}
      </p>
      {active && (
        <div className="flex items-center gap-1 shrink-0">
          {paused ? (
            <Button variant="ghost" size="sm" onClick={handleResume} data-testid="computer-session-resume">
              <Play className="w-3 h-3" />
              继续
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={handlePause} data-testid="computer-session-pause">
              <Pause className="w-3 h-3" />
              暂停
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={handleStop} data-testid="computer-session-stop">
            <Square className="w-3 h-3" />
            停止
          </Button>
        </div>
      )}
    </div>
  );
}
