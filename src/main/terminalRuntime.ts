/**
 * Terminal Runtime V2（Electron Main / Node 侧执行核心；不依赖 electron API）。
 *
 * 职责（Phase 1–3 契约）：
 * - spawn PowerShell/cmd（windowsHide、shell:false、不 elevation）
 * - stdout/stderr 流式事件（sanitized：ANSI strip + absolute path/secret redaction + char bound；
 *   sequence 单调递增）
 * - 最终 bounded aggregate（原始累积 512KB 上限 + 截断标志；与 V1 execute 返回契约一致）
 * - timeout（foreground 1–120s / long-running 1–600s）→ process tree kill
 * - cancel（幂等；process tree kill；reject CANCELLED）
 * - late chunk 忽略（settled 后不再发事件 / 不再修改结果）
 * - 单次 resolve/reject（settled 防双 completion）
 */
import { spawn } from "node:child_process";
import { sanitizeTerminalChunk } from "@/lib/ai/computer/terminal/redact";
import { DesktopTerminalEvent, DesktopTerminalExecutionMode } from "@/lib/desktop/types";

export interface TerminalRuntimeResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export interface TerminalRuntimeHandle {
  executionId: string;
  /** 幂等 cancel；process tree 终止后 reject CANCELLED */
  cancel(): Promise<void>;
}

export interface TerminalRuntimeOptions {
  executionId: string;
  shell: "powershell" | "cmd";
  /** native absolute cwd（已由 bridge 层 resolveWithinRoot 校验） */
  cwd: string;
  command: string;
  timeoutMs: number;
  executionMode?: DesktopTerminalExecutionMode;
  onEvent: (event: DesktopTerminalEvent) => void;
}

export const TERMINAL_RUNTIME_MAX_OUTPUT_BYTES = 512 * 1024;
export const TERMINAL_TIMEOUT_FOREGROUND_MAX_MS = 120_000;
export const TERMINAL_TIMEOUT_LONG_RUNNING_MAX_MS = 600_000;

/** 进程树终止（Windows）：taskkill /pid <pid> /t /f */
export function killProcessTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    try {
      const killer = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.on("close", () => resolve());
      killer.on("error", () => resolve());
      // 兜底：taskkill 自身卡住不阻塞 cancel
      setTimeout(() => resolve(), 2_000).unref();
    } catch {
      resolve();
    }
  });
}

interface Accumulator {
  text: string;
  truncated: boolean;
}

function collect(acc: Accumulator, chunk: string): void {
  if (acc.truncated) return;
  const max = TERMINAL_RUNTIME_MAX_OUTPUT_BYTES;
  if (Buffer.byteLength(acc.text + chunk, "utf8") > max) {
    acc.text = acc.text.slice(0, Math.floor(max / 2));
    acc.truncated = true;
    return;
  }
  acc.text += chunk;
}

/**
 * 启动一次 terminal 执行。
 * 返回 { promise, handle }：promise 在 close/timeout/cancel 后 settle（V1 execute 返回契约）；
 * handle.cancel() 幂等终止整棵进程树并 reject CANCELLED。
 */
export function runTerminalProcess(
  options: TerminalRuntimeOptions
): { promise: Promise<TerminalRuntimeResult>; handle: TerminalRuntimeHandle } {
  const { executionId, shell, cwd, command, onEvent } = options;
  const maxTimeout =
    options.executionMode === "long-running"
      ? TERMINAL_TIMEOUT_LONG_RUNNING_MAX_MS
      : TERMINAL_TIMEOUT_FOREGROUND_MAX_MS;
  const timeoutMs = Math.min(Math.max(options.timeoutMs, 1_000), maxTimeout);

  let resolveResult: (r: TerminalRuntimeResult) => void = () => {};
  let rejectResult: (e: Error) => void = () => {};
  const promise = new Promise<TerminalRuntimeResult>((res, rej) => {
    resolveResult = res;
    rejectResult = rej;
  });

  const startedAt = Date.now();
  let sequence = 0;
  let settled = false;
  let cancelled = false;
  let timedOut = false;
  let timer: NodeJS.Timeout | null = null;

  const stdout: Accumulator = { text: "", truncated: false };
  const stderr: Accumulator = { text: "", truncated: false };

  const emit = (event: DesktopTerminalEvent) => {
    if (settled && event.type !== "exit") return; // late chunk 不发（completed activity 不再被修改）
    onEvent(event);
  };

  const finish = () => {
    if (settled) return;
    settled = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const durationMs = Date.now() - startedAt;
    emit({
      type: "exit",
      executionId,
      sequence: ++sequence,
      exitCode: child?.exitCode ?? null,
      timedOut,
      cancelled,
      durationMs,
    });
    if (cancelled) {
      const err = new Error("CANCELLED") as Error & { code: string };
      err.code = "CANCELLED";
      rejectResult(err);
    } else {
      // timeout 是 process outcome：resolve timedOut=true（Bridge 契约绝不 reject TIMEOUT）
      resolveResult({
        exitCode: child?.exitCode ?? null,
        stdout: stdout.text,
        stderr: stderr.text,
        timedOut,
        durationMs,
        stdoutTruncated: stdout.truncated,
        stderrTruncated: stderr.truncated,
      });
    }
  };

  let child: ReturnType<typeof spawn> | null = null;
  try {
    const args =
      shell === "powershell"
        ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command]
        : ["/d", "/s", "/c", command];
    child = spawn(shell === "powershell" ? "powershell.exe" : "cmd.exe", args, {
      cwd,
      windowsHide: true,
      shell: false,
    });
  } catch (err) {
    settled = true;
    const e = new Error("EXECUTION_FAILED") as Error & { code: string };
    e.code = "EXECUTION_FAILED";
    void err;
    rejectResult(e);
    return {
      promise,
      handle: {
        executionId,
        cancel: async () => {},
      },
    };
  }

  emit({ type: "started", executionId, sequence: ++sequence });

  child.stdout?.on("data", (buf: Buffer) => {
    if (settled) return;
    const text = buf.toString("utf8");
    collect(stdout, text);
    emit({ type: "stdout", executionId, sequence: ++sequence, text: sanitizeTerminalChunk(text) });
  });
  child.stderr?.on("data", (buf: Buffer) => {
    if (settled) return;
    const text = buf.toString("utf8");
    collect(stderr, text);
    emit({ type: "stderr", executionId, sequence: ++sequence, text: sanitizeTerminalChunk(text) });
  });
  child.on("error", () => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    emit({
      type: "exit",
      executionId,
      sequence: ++sequence,
      exitCode: null,
      timedOut: false,
      cancelled: false,
      durationMs: Date.now() - startedAt,
    });
    const e = new Error("EXECUTION_FAILED") as Error & { code: string };
    e.code = "EXECUTION_FAILED";
    rejectResult(e);
  });
  child.on("close", () => finish());

  timer = setTimeout(() => {
    if (settled) return;
    timedOut = true; // timeout 是 outcome：resolve timedOut=true（不设 cancelled）
    const pid = child?.pid ?? null;
    if (pid !== null) {
      void killProcessTree(pid).then(() => finish());
    } else {
      finish();
    }
  }, timeoutMs);

  const cancel = async (): Promise<void> => {
    if (settled || cancelled) return;
    cancelled = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const pid = child?.pid ?? null;
    if (pid !== null) {
      await killProcessTree(pid);
    }
    finish();
  };

  return {
    promise,
    handle: { executionId, cancel },
  };
}
