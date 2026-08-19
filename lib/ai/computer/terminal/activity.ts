/**
 * Terminal Activity（runtime-only；UI 实时展示，不进入模型 context / audit）。
 * - 与 KiroComputerChange 分离：高频 stdout/stderr 绝不承载到 Task/Change 模型。
 * - 纯函数 reducer（applyTerminalEvent）：deterministic、可直接单测。
 * - ring buffer 限制行数 / 字符数（UI 有界；最终 Tool Result 走 executor 既有 bound）。
 */
import { DesktopTerminalEvent } from "@/lib/desktop/types";

export type TerminalActivityStatus =
  | "starting"
  | "running"
  | "waiting-input"
  | "stopping"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed-out";

export interface TerminalActivityInit {
  executionId: string;
  toolCallId: string;
  shell: string;
  commandPreview: string;
}

export interface TerminalActivity {
  executionId: string;
  toolCallId: string;
  shell: string;
  commandPreview: string;
  status: TerminalActivityStatus;
  startedAt: number;
  exitCode: number | null;
  durationMs: number;
  stdoutLines: string[];
  stderrLines: string[];
  truncated: boolean;
  waitingForInput: boolean;
}

/** UI ring buffer：最近行数上限 / 字符数上限 */
export const TERMINAL_ACTIVITY_MAX_LINES = 200;
export const TERMINAL_ACTIVITY_MAX_CHARS = 60_000;

/** 文本按行拆分 + 追加到 ring buffer（超限丢弃最旧行；字符超限置 truncated） */
export function appendLines(buffer: string[], chunk: string, truncatedRef: { truncated: boolean }): string[] {
  const lines = chunk.split(/\r?\n/);
  let next = [...buffer];
  let chars = next.reduce((n, l) => n + l.length, 0);
  for (const line of lines) {
    if (line.length === 0 && next.length > 0) continue; // 合并空行（避免空行刷屏）
    next.push(line);
    chars += line.length;
  }
  if (next.length > TERMINAL_ACTIVITY_MAX_LINES) {
    next = next.slice(next.length - TERMINAL_ACTIVITY_MAX_LINES);
    truncatedRef.truncated = true;
  }
  if (chars > TERMINAL_ACTIVITY_MAX_CHARS) {
    // 丢弃最旧行直到字符数达标（至少保留 1 行）
    while (next.length > 1 && next.reduce((n, l) => n + l.length, 0) > TERMINAL_ACTIVITY_MAX_CHARS) {
      next.shift();
    }
    truncatedRef.truncated = true;
  }
  return next;
}

export function createTerminalActivity(init: TerminalActivityInit, at = Date.now()): TerminalActivity {
  return {
    executionId: init.executionId,
    toolCallId: init.toolCallId,
    shell: init.shell,
    commandPreview: init.commandPreview,
    status: "starting",
    startedAt: at,
    exitCode: null,
    durationMs: 0,
    stdoutLines: [],
    stderrLines: [],
    truncated: false,
    waitingForInput: false,
  };
}

/**
 * 事件 → activity 状态机（确定性）：
 * - started → running（并记 startedAt）
 * - stdout/stderr → 追加到 ring buffer（completed 后的事件忽略——late chunk 不改 completed）
 * - exit → completed（exitCode=0）/ failed（exitCode≠0）/ cancelled / timed-out
 *   （exit 事件后忽略后续事件：activity 进入终态）
 */
export function applyTerminalEvent(
  activity: TerminalActivity | undefined,
  event: DesktopTerminalEvent,
  at = Date.now()
): TerminalActivity | undefined {
  if (activity && isTerminalActivityTerminal(activity.status)) return activity; // 终态不再修改

  switch (event.type) {
    case "started":
      if (!activity) return undefined; // 无 init 元数据的孤儿事件：忽略
      return { ...activity, status: "running" };
    case "stdout": {
      if (!activity) return undefined;
      const truncatedRef = { truncated: activity.truncated };
      const stdoutLines = appendLines(activity.stdoutLines, event.text, truncatedRef);
      return { ...activity, stdoutLines, truncated: truncatedRef.truncated, status: activity.status === "starting" ? "running" : activity.status };
    }
    case "stderr": {
      if (!activity) return undefined;
      const truncatedRef = { truncated: activity.truncated };
      const stderrLines = appendLines(activity.stderrLines, event.text, truncatedRef);
      return { ...activity, stderrLines, truncated: truncatedRef.truncated, status: activity.status === "starting" ? "running" : activity.status };
    }
    case "exit": {
      if (!activity) return undefined;
      const status: TerminalActivityStatus = event.cancelled
        ? event.timedOut
          ? "timed-out"
          : "cancelled"
        : event.exitCode === 0
          ? "completed"
          : "failed";
      return {
        ...activity,
        status,
        exitCode: event.exitCode,
        durationMs: event.durationMs,
        startedAt: Math.min(activity.startedAt, at - event.durationMs),
      };
    }
  }
}

export function isTerminalActivityTerminal(status: TerminalActivityStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "timed-out";
}
