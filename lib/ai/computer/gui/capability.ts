/**
 * Desktop Action Capability Resolver（Computer Use Phase 2）。
 *
 * desktop_action 暴露条件（全部满足）：
 * 1. Computer 启用
 * 2. 用户开启「允许 Kiro 查看桌面」（观察是操作的前提）
 * 3. 用户开启「允许 Kiro 操作电脑」（独立开关，不与 Terminal 绑定）
 * 4. Desktop Computer Bridge 同时支持 observe + action（version >= 2）
 * 5. Agent Mode 不是 plan（plan 永远只读）
 *
 * 与 Tool Exposure / Capability Prompt 必须同源使用本 resolver。
 * 绝不读取 client 自报其它字段；绝不泄漏 native window handle / HWND / PID / path。
 */
import { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";

export type GuiControlCapabilityState =
  | {
      available: true;
      reason: "ready";
    }
  | {
      available: false;
      reason:
        | "computer-disabled"
        | "observe-disabled"
        | "permission-disabled"
        | "runtime-unavailable"
        | "mode-read-only";
    };

export function resolveGuiControlCapability(
  snapshot: KiroComputerTurnSnapshot | null
): GuiControlCapabilityState {
  if (!snapshot?.enabled) return { available: false, reason: "computer-disabled" };
  if (snapshot.desktopControlEnabled !== true) return { available: false, reason: "observe-disabled" };
  if (snapshot.desktopActionEnabled !== true) return { available: false, reason: "permission-disabled" };
  if (snapshot.desktopControlAvailable !== true || snapshot.desktopActionAvailable !== true) {
    return { available: false, reason: "runtime-unavailable" };
  }
  if (snapshot.agentMode === "plan") return { available: false, reason: "mode-read-only" };
  return { available: true, reason: "ready" };
}
