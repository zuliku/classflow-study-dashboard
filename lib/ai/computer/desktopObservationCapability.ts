/**
 * Desktop Observation Capability Resolver（Computer Use Phase 1）。
 *
 * 唯一逻辑来源：Kiro 当前 Turn 是否可用 observe_desktop，由 Computer 启用 +
 * 用户偏好（允许 Kiro 查看桌面）+ Desktop Computer Bridge 三道路径共同决定。
 *
 * - 只基于经过 server validation 的 KiroComputerTurnSnapshot（frozen 于 Send 边界）。
 * - 与 Tool Exposure / Capability Prompt 必须同源使用本 resolver。
 * - 绝不读取 client 自报的其它字段；绝不泄漏 native window handle / HWND / PID / path。
 */
import { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";

export type DesktopObservationCapabilityState =
  | {
      available: true;
      reason: "ready";
    }
  | {
      available: false;
      reason: "computer-disabled" | "permission-disabled" | "runtime-unavailable";
    };

/**
 * 判定顺序（deterministic）：
 * 1. Computer 未启用                  → computer-disabled
 * 2. desktopControlEnabled !== true   → permission-disabled
 * 3. desktopControlAvailable !== true → runtime-unavailable
 * 4. 全部满足                         → ready
 */
export function resolveDesktopObservationCapability(
  snapshot: KiroComputerTurnSnapshot | null
): DesktopObservationCapabilityState {
  if (!snapshot?.enabled) return { available: false, reason: "computer-disabled" };
  if (snapshot.desktopControlEnabled !== true) return { available: false, reason: "permission-disabled" };
  if (snapshot.desktopControlAvailable !== true) return { available: false, reason: "runtime-unavailable" };
  return { available: true, reason: "ready" };
}
