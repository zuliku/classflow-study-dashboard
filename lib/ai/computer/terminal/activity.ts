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

/** 文本按行拆分 + 追加到 ring buffer（超限丢弃最旧行；字符超限置 truncated）
 * P1 性能：增量维护 chars（此前每次 reduce 全量 + 超限 while 内再全量 reduce = O(N²)） */
export function appendLines(buffer: string[], chunk: string, truncatedRef: { truncated: boolean }): string[] {
  const lines = chunk.split(/\r?\n/);
  let next = [...buffer];
  // 首 token 冷启动才全量算一次；后续调用方传入的 buffer 已有界（200行/60k字符），单次 reduce 上限可控
  let chars = 0;
  for (let i = 0; i < next.length; i++) chars += next[i].length;
  for (const line of lines) {
    if (line.length === 0 && next.length > 0) continue; // 合并空行（避免空行刷屏）
    next.push(line);
    chars += line.length;
  }
  if (next.length > TERMINAL_ACTIVITY_MAX_LINES) {
    const drop = next.length - TERMINAL_ACTIVITY_MAX_LINES;
    for (let i = 0; i < drop; i++) chars -= next[i].length;
    next = next.slice(drop);
    truncatedRef.truncated = true;
  }
  if (chars > TERMINAL_ACTIVITY_MAX_CHARS) {
    // 丢弃最旧行直到字符数达标（至少保留 1 行）；同步减 chars，不再循环内 reduce
    let drop = 0;
    while (next.length - drop > 1 && chars > TERMINAL_ACTIVITY_MAX_CHARS) {
      chars -= next[drop].length;
      drop += 1;
    }
    if (drop > 0) {
      next = next.slice(drop);
      truncatedRef.truncated = true;
    }
  }
  return next;
}

/** 行数组浅比较（先比长度+首尾行，miss 才 join；此前每次 join 全量 60k 分配比对） */
export function sameTerminalLines(a: string[], b: string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  if (a.length === 0) return true;
  if (a[0] !== b[0]) return false;
  if (a[a.length - 1] !== b[b.length - 1]) return false;
  // 中间行抽查（高频输出尾部追加时首尾相同概率低，此处已能提前返回；全量 join 只走最后兜底）
  if (a.length > 2) {
    const mid = (a.length / 2) | 0;
    if (a[mid] !== b[mid]) return false;
  }
  return a.join("\n") === b.join("\n");
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
      let status: TerminalActivityStatus;
      // timeout 优先级最高（即使 exitCode=null 也应为 timed-out，而非 failed）
      if (event.timedOut) status = "timed-out";
      else if (event.cancelled) status = "cancelled";
      else if (event.exitCode === 0) status = "completed";
      else status = "failed";
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
