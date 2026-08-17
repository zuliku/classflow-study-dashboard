/**
 * Kiro Turn Handoff 测量（Streaming UX V4.6；严格 test/DEV-only）。
 *
 * 只有 window.__kiroTurnPerf 存在（Playwright addInitScript 注入）才记账；
 * 生产环境不存在该全局 → 每次调用一次属性访问，无其它开销。
 *
 * 时间点（全部 performance.now 域，E2E 用 Date.now 偏移换算）：
 * - sendClaim：Send 入口同步 claim（sendLock 生效）
 * - intentFrozen：Turn Intent 同步冻结（第一个 await 之前）
 * - preflightStart / preflightEnd：并行 preflight（project/workspace/vision）
 * - turnSnapshotCommitted：turnSnapshotRef 写入（请求体已确定）
 * - chatSendMessage：SDK sendMessage 调用
 * - toolCallReceived / toolExecutionStart / toolExecutionComplete / addToolOutput：
 *   emitToolOutput 链路真实时间点（不记录 tool 内容）
 *
 * __kiroTurnPerfConfig（E2E 注入）：{ projectDelayMs, workspaceDelayMs, visionDelayMs }
 * → 对应 preflight 分支人为延迟（测试 preflight 并行/串行用；生产无全局 → 0）。
 */

export interface KiroTurnPerfEntry {
  name: string;
  at: number;
  /** 可选：toolCallId / toolName 等标识（绝不记录 tool 输入/输出内容） */
  key?: string;
}

function perfGlobal(): {
  __kiroTurnPerf?: KiroTurnPerfEntry[];
  __kiroTurnPerfConfig?: Record<string, number | boolean>;
} | null {
  if (typeof window === "undefined") return null;
  return window as unknown as {
    __kiroTurnPerf?: KiroTurnPerfEntry[];
    __kiroTurnPerfConfig?: Record<string, number | boolean>;
  };
}

export function turnPerf(name: string, key?: string): void {
  const g = perfGlobal();
  if (!g || !g.__kiroTurnPerf) return;
  g.__kiroTurnPerf.push({ name, at: performance.now(), ...(key != null ? { key } : {}) });
}

/** test-only preflight 分支延迟（E2E 并行/串行回归用；无配置 → 0） */
export function turnPerfPreflightDelay(branch: "project" | "workspace" | "vision"): number {
  const g = perfGlobal();
  if (!g || !g.__kiroTurnPerfConfig) return 0;
  const v = g.__kiroTurnPerfConfig[`${branch}DelayMs`];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

/** test-only preflight 失败注入（E2E 回滚回归用；无配置 → false） */
export function turnPerfPreflightFail(branch: "project" | "workspace" | "vision"): boolean {
  const g = perfGlobal();
  if (!g || !g.__kiroTurnPerfConfig) return false;
  const v = g.__kiroTurnPerfConfig[`${branch}Fail`];
  return v === true;
}

export function sleepTurnPerf(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
