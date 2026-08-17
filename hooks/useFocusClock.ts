"use client";

import { useEffect, useState } from "react";
import { FocusSession } from "@/types";
import { deriveFocusClock } from "@/lib/focus/focusDomain";
import { formatFocusClock } from "@/lib/focus/focusView";

/**
 * Task Execution Loop V1：Focus 计时的 1s UI tick（只读 deriveFocusClock，不写 Store）。
 * 关键约束：tick 只重渲染调用该 hook 的组件（控制条 / 执行行时钟等小子树），
 * 严禁把 tick 提升到 AssignmentDrawer / 大 section —— 否则整面板每秒 rerender。
 * session 为 null 或 completed 时不起 interval，返回空串。
 */
export function useFocusClock(session: FocusSession | null) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!session || session.status === "completed") return;
    const t = window.setInterval(() => setTick((v) => v + 1), 1000);
    return () => window.clearInterval(t);
  }, [session]);

  if (!session || session.status === "completed") {
    return { remainingText: "", elapsedText: "", remainingMs: 0, elapsedMs: 0 };
  }

  const now = Date.now();
  const clock = deriveFocusClock(session, now);
  return {
    remainingText: formatFocusClock(clock.remainingMs),
    elapsedText: formatFocusClock(clock.elapsedMs),
    remainingMs: clock.remainingMs,
    elapsedMs: clock.elapsedMs,
  };
}
