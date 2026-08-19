/**
 * PTY Session Runtime V2（Phase 4）—— Persistent Agent PowerShell Session（Windows ConPTY via node-pty）。
 *
 * - 只在本机 Windows x64 提供；不 elevation / 不 admin / 不开额外 terminal window
 * - cwd 必须来自授权 root（由 bridge 层 resolveWithinRoot 校验；此处只接收 native cwd）
 * - session dispose 必须 kill process tree（term.kill() 终止会话进程）
 * - data 事件已经 sanitization（ANSI 剥离 + path/secret redaction + char bound）
 * - 不持久化 session 日志；sessions 为 runtime-only registry
 * - PTY 不构成对 run_terminal_command Risk Classifier 的绕过：Agent 侧不提供
 *   send_arbitrary_keys 工具；Agent 命令仍走 run_terminal_command policy。
 */
// @ts-ignore: node-pty types not available in this tsconfig
import * as pty from "node-pty";
import { randomUUID } from "node:crypto";
import { sanitizeTerminalChunk } from "@/lib/ai/computer/terminal/redact";
import { DesktopTerminalSessionEvent } from "@/lib/desktop/types";

export interface PtySessionOptions {
  shell: "powershell" | "cmd";
  cwd: string;
  cols: number;
  rows: number;
  onEvent: (event: DesktopTerminalSessionEvent) => void;
}

export const PTY_MAX_COLS = 500;
export const PTY_MAX_ROWS = 200;
export const PTY_MIN_COLS = 20;
export const PTY_MIN_ROWS = 5;

function ptyOperationError(code: string): Error & { code: string } {
  const e = new Error(code) as Error & { code: string };
  e.code = code;
  return e;
}

interface PtySessionRecord {
  sessionId: string;
  term: pty.IPty;
}

const sessions = new Map<string, PtySessionRecord>();

export function createPtySession(options: PtySessionOptions): string {
  const sessionId = `pty-${randomUUID().slice(0, 8)}`;
  const cols = Math.min(Math.max(Math.floor(options.cols), PTY_MIN_COLS), PTY_MAX_COLS);
  const rows = Math.min(Math.max(Math.floor(options.rows), PTY_MIN_ROWS), PTY_MAX_ROWS);
  // PTY 保持交互能力：保留 -NoLogo -NoProfile（避免加载用户 profile），移除 -NonInteractive
  const shellArgs = options.shell === "powershell" ? ["-NoLogo", "-NoProfile"] : [];
  const term = pty.spawn(options.shell === "powershell" ? "powershell.exe" : "cmd.exe", shellArgs, {
    name: "xterm-color",
    cols,
    rows,
    cwd: options.cwd,
    env: { ...process.env },
  });
  term.onData((data: string) => {
    options.onEvent({ type: "data", sessionId, data: sanitizeTerminalChunk(data) });
  });
  term.onExit(({ exitCode }: { exitCode: number }) => {
    sessions.delete(sessionId);
    options.onEvent({ type: "exit", sessionId, exitCode });
  });
  sessions.set(sessionId, { sessionId, term });
  return sessionId;
}

export function writePtySession(sessionId: string, data: string): void {
  const record = sessions.get(sessionId);
  if (!record) throw ptyOperationError("INVALID_OPERATION");
  if (data.length === 0 || data.length > 4096) throw ptyOperationError("INVALID_OPERATION");
  record.term.write(data);
}

export function resizePtySession(sessionId: string, cols: number, rows: number): void {
  const record = sessions.get(sessionId);
  if (!record) throw ptyOperationError("INVALID_OPERATION");
  record.term.resize(
    Math.min(Math.max(Math.floor(cols), PTY_MIN_COLS), PTY_MAX_COLS),
    Math.min(Math.max(Math.floor(rows), PTY_MIN_ROWS), PTY_MAX_ROWS)
  );
}

export function closePtySession(sessionId: string): void {
  const record = sessions.get(sessionId);
  if (!record) return; // 幂等
  sessions.delete(sessionId);
  try {
    record.term.kill();
  } catch {
    /* 已退出 */
  }
}

/** App 关闭：dispose 全部 PTY session（kill process tree；不留下 orphan） */
export function closeAllPtySessions(): void {
  for (const record of Array.from(sessions.values())) {
    sessions.delete(record.sessionId);
    try {
      record.term.kill();
    } catch {
      /* 忽略 */
    }
  }
}

export function activePtySessionCount(): number {
  return sessions.size;
}
