/**
 * Terminal Capability Resolver（Desktop Terminal V1.0.1）。
 *
 * 唯一逻辑来源：Kiro「当前 Turn 是否可用 Terminal」由 Runtime + Permission +
 * Native Workspace + Computer 四道 Gate 共同决定。
 *
 * - 只基于经过 server validation 的 KiroComputerTurnSnapshot（frozen 于 Send 边界）。
 * - 绝不读取 client 自报的其它字段；绝不泄漏 native path / grantId / adapterRef。
 * - Capability Prompt 与 run_terminal_command Tool Exposure 必须同源使用本 resolver。
 */
import { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";

export type TerminalCapabilityState =
  | {
      available: true;
      reason: "ready";
    }
  | {
      available: false;
      reason:
        | "computer-disabled"
        | "permission-disabled"
        | "runtime-unavailable"
        | "native-workspace-required";
    };

/**
 * 判定顺序（deterministic）：
 * 1. Computer 未启用            → computer-disabled
 * 2. terminalEnabled !== true   → permission-disabled
 * 3. terminalAvailable !== true → runtime-unavailable
 * 4. hasNativeRoot !== true     → native-workspace-required
 * 5. 全部满足                   → ready
 */
export function resolveTerminalCapability(
  snapshot: KiroComputerTurnSnapshot | null
): TerminalCapabilityState {
  if (!snapshot?.enabled) return { available: false, reason: "computer-disabled" };
  if (snapshot.terminalEnabled !== true) return { available: false, reason: "permission-disabled" };
  if (snapshot.terminalAvailable !== true) return { available: false, reason: "runtime-unavailable" };
  if (snapshot.hasNativeRoot !== true) return { available: false, reason: "native-workspace-required" };
  return { available: true, reason: "ready" };
}
