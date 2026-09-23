"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getClassFlowDesktopComputerSessionBridge } from "@/lib/desktop/bridge";
import { applyDesktopSessionStatus, useDesktopSessionStore } from "@/store/useDesktopSessionStore";
import { useToastStore } from "@/store/useToastStore";
import { isDesktopSessionTerminalState } from "@/lib/ai/ui/kiroComputerSession";

/** 本地交互态（防重复点击；不进入任何 store / 不持久化） */
export type DesktopSessionActionState = "idle" | "pausing" | "resuming" | "stopping";

/** Stop 后等待 terminal 事件的兜底时长（事件丢失时解锁按钮） */
const STOPPING_FALLBACK_MS = 3_000;

/**
 * Desktop Session 控制动作（P5 §14/§15）：
 * - Pause / Resume 走 canonical bridge（pauseSession / resumeSession），成功后把完整 status 写回 store；
 * - Stop 继续 dispatch canonical `classflow:computer:stop`（useKiroChat 统一取消 Session + 当前 Agent Turn）；
 * - 失败只显示 sanitized Toast（绝不回显 raw bridge error）；
 * - pending 期间按钮 disable，防止连续点击。
 */
export function useKiroComputerSessionActions() {
  const [pending, setPending] = useState<DesktopSessionActionState>("idle");
  const pushToast = useToastStore((s) => s.pushToast);
  const sessionState = useDesktopSessionStore((s) => s.state);
  const stoppingTimerRef = useRef<number | null>(null);

  // Stop：terminal 事件到达 → 解锁（比固定 timeout 更准确）
  useEffect(() => {
    if (pending === "stopping" && sessionState !== null && isDesktopSessionTerminalState(sessionState)) {
      if (stoppingTimerRef.current !== null) window.clearTimeout(stoppingTimerRef.current);
      stoppingTimerRef.current = null;
      setPending("idle");
    }
  }, [pending, sessionState]);

  useEffect(() => {
    return () => {
      if (stoppingTimerRef.current !== null) window.clearTimeout(stoppingTimerRef.current);
    };
  }, []);

  const pause = useCallback(
    async (sessionId: string) => {
      if (pending !== "idle") return;
      const bridge = getClassFlowDesktopComputerSessionBridge();
      if (!bridge) return;
      setPending("pausing");
      try {
        const status = await bridge.pauseSession({ sessionId });
        applyDesktopSessionStatus(status);
      } catch {
        pushToast({ message: "暂停电脑操作失败", type: "error" });
      } finally {
        setPending("idle");
      }
    },
    [pending, pushToast]
  );

  const resume = useCallback(
    async (sessionId: string) => {
      if (pending !== "idle") return;
      const bridge = getClassFlowDesktopComputerSessionBridge();
      if (!bridge) return;
      setPending("resuming");
      try {
        const status = await bridge.resumeSession({ sessionId });
        applyDesktopSessionStatus(status);
      } catch {
        pushToast({ message: "继续电脑操作失败", type: "error" });
      } finally {
        setPending("idle");
      }
    },
    [pending, pushToast]
  );

  const stop = useCallback(() => {
    if (pending !== "idle") return;
    setPending("stopping");
    // canonical Stop：useKiroChat.handleStop（取消 Desktop Session + 停止当前 Agent Turn）
    window.dispatchEvent(new CustomEvent("classflow:computer:stop"));
    // 兜底：terminal 事件未到达时解锁（UI 不永久卡死）
    stoppingTimerRef.current = window.setTimeout(() => {
      stoppingTimerRef.current = null;
      setPending((value) => (value === "stopping" ? "idle" : value));
    }, STOPPING_FALLBACK_MS);
  }, [pending]);

  return { pending, pause, resume, stop };
}
