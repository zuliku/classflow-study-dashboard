/**
 * Task 3：Focus Runtime 纯决策层（复用 Task 2 deriveFocusClock，不复制时间算法）。
 * booting：页面 hydrate 后的 recovered 结算（只站内 Toast，不补响铃/系统通知）。
 * running：live 完成（Toast + 提示音 + Browser Notification，仅 ok:true 后）。
 */

import { FocusSession } from "@/types";
import { deriveFocusClock } from "@/lib/focus/focusDomain";

export type FocusRuntimePhase = "booting" | "running";

export type FocusRuntimeDecision =
  | "none"
  | "complete-recovered"
  | "complete-live";

export function getFocusRuntimeDecision(
  session: FocusSession | null | undefined,
  now: number,
  phase: FocusRuntimePhase
): FocusRuntimeDecision {
  if (!session) return "none";
  if (session.status !== "running") return "none";
  const clock = deriveFocusClock(session, now);
  if (clock.remainingMs > 0) return "none";
  return phase === "booting" ? "complete-recovered" : "complete-live";
}
