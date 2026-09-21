/**
 * Computer Use V2.2 — 常驻 UIA Worker 管理器（Node / Electron Main）。
 *
 * 职责：
 * - 懒启动一个 `powershell.exe -Command -` 常驻进程（stdin/stdout JSON lines）
 * - 请求/响应按 id 关联；并发安全
 * - 超时 / 崩溃 / 写失败 → reject + 杀掉并重启（下一次请求自动拉起）
 * - 空闲回收（默认 5 分钟无请求 → 释放进程；下次请求重新启动）
 * - 启动失败（无 PowerShell / 脚本错误）→ WorkerUnavailableError（调用方回退一次性脚本）
 *
 * 该模块不依赖 electron，也不 import 其它 computer 模块（除脚本 builder），便于单测注入 spawnFn。
 */
import { spawn, ChildProcess } from "node:child_process";
import { gzipSync } from "node:zlib";
import { buildUiaWorkerScript } from "./uiaWorkerScript";

export const UIA_WORKER_REQUEST_TIMEOUT_MS = 8_000;
export const UIA_WORKER_ACT_TIMEOUT_MS = 12_000;
export const UIA_WORKER_IDLE_TIMEOUT_MS = 5 * 60_000;
export const UIA_WORKER_PING_TIMEOUT_MS = 4_000;
export const UIA_WORKER_MAX_OUTPUT_LINE = 1024 * 1024;

export class UiaWorkerUnavailableError extends Error {
  readonly code = "UIA_WORKER_UNAVAILABLE";
  constructor(message = "UIA worker unavailable") {
    super(message);
    this.name = "UiaWorkerUnavailableError";
  }
}

export class UiaWorkerRequestError extends Error {
  readonly code = "UIA_WORKER_REQUEST";
  readonly reason: string;
  constructor(reason: string, message?: string) {
    super(message ?? reason);
    this.name = "UiaWorkerRequestError";
    this.reason = reason;
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface UiaWorkerOptions {
  /** 测试注入：返回一个已启动的子进程（默认 powershell -EncodedCommand） */
  spawnFn?: () => ChildProcess;
  requestTimeoutMs?: number;
  idleTimeoutMs?: number;
  now?: () => number;
  /** 测试注入：是否创建空闲回收定时器（默认 true） */
  enableIdleTimer?: boolean;
}

export class UiaWorker {
  private child: ChildProcess | null = null;
  private stdoutBuffer = "";
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private starting: Promise<void> | null = null;
  private unavailableReason: string | null = null;
  private lastUsedAt = 0;
  private idleTimer: NodeJS.Timeout | null = null;
  private disposed = false;

  private readonly spawnFn: () => ChildProcess;
  private readonly requestTimeoutMs: number;
  private readonly idleTimeoutMs: number;
  private readonly now: () => number;

  constructor(options: UiaWorkerOptions = {}) {
    this.spawnFn = options.spawnFn ?? (() => defaultSpawn());
    this.requestTimeoutMs = options.requestTimeoutMs ?? UIA_WORKER_REQUEST_TIMEOUT_MS;
    this.idleTimeoutMs = options.idleTimeoutMs ?? UIA_WORKER_IDLE_TIMEOUT_MS;
    this.now = options.now ?? (() => Date.now());
    if (options.enableIdleTimer !== false) {
      this.idleTimer = setInterval(() => this.recycleIfIdle(), Math.min(this.idleTimeoutMs, 60_000));
      this.idleTimer.unref?.();
    }
  }

  /** 进程是否存活（诊断用） */
  isRunning(): boolean {
    return this.child !== null && !this.child.killed;
  }

  /** 发一个请求；基础设施失败 → UiaWorkerUnavailableError；业务失败 → UiaWorkerRequestError */
  async request<T>(
    op: "ping" | "windows" | "inspect" | "resolve" | "act" | "activate",
    payload: Record<string, unknown> = {},
    timeoutMs?: number
  ): Promise<T> {
    if (this.disposed) throw new UiaWorkerUnavailableError("worker disposed");
    await this.ensureStarted();
    const child = this.child;
    if (!child || !child.stdin || child.stdin.destroyed) {
      throw new UiaWorkerUnavailableError(this.unavailableReason ?? "worker not running");
    }
    this.lastUsedAt = this.now();
    const id = this.nextId++;
    const effectiveTimeout =
      timeoutMs ?? (op === "act" ? UIA_WORKER_ACT_TIMEOUT_MS : this.requestTimeoutMs);

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // 超时说明 worker 已不可信：杀掉并让下一次请求重启
        this.restart("request-timeout");
        reject(new UiaWorkerUnavailableError("worker request timeout"));
      }, effectiveTimeout);
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      try {
        child.stdin!.write(`${JSON.stringify({ id, op, payload })}\n`);
      } catch {
        this.pending.delete(id);
        clearTimeout(timer);
        this.restart("write-failed");
        reject(new UiaWorkerUnavailableError("worker write failed"));
      }
    });
  }

  /** 空闲回收：长时间无请求 → 释放进程（下次请求自动重启） */
  recycleIfIdle(): boolean {
    if (this.disposed || !this.child) return false;
    if (this.pending.size > 0) return false;
    if (this.now() - this.lastUsedAt < this.idleTimeoutMs) return false;
    this.stop("idle-recycle");
    return true;
  }

  dispose(): void {
    this.disposed = true;
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    this.stop("disposed");
  }

  private async ensureStarted(): Promise<void> {
    if (this.child) return;
    if (this.starting) return this.starting;
    this.unavailableReason = null;
    this.starting = (async () => {
      let child: ChildProcess;
      try {
        child = this.spawnFn();
      } catch (err) {
        this.unavailableReason = err instanceof Error ? err.message : "spawn failed";
        throw new UiaWorkerUnavailableError(this.unavailableReason);
      }
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const fail = (reason: string) => {
          if (settled) return;
          settled = true;
          this.unavailableReason = reason;
          reject(new UiaWorkerUnavailableError(reason));
        };
        child.once("error", () => fail("worker spawn error"));
        child.once("exit", () => fail("worker exited during startup"));
        // 首帧 ping：确认脚本已加载并进入 loop
        const timer = setTimeout(() => fail("worker ping timeout"), UIA_WORKER_PING_TIMEOUT_MS);
        this.attach(child);
        this.pingForStartup()
          .then(() => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            this.child = child;
            this.lastUsedAt = this.now();
            resolve();
          })
          .catch(() => {
            clearTimeout(timer);
            fail("worker ping failed");
          });
      });
    })()
      .catch((err) => {
        this.stop("startup-failed");
        throw err;
      })
      .finally(() => {
        this.starting = null;
      });
    return this.starting;
  }

  private pingForStartup(): Promise<void> {
    // attach 已完成；这里直接走 request 通道（child 尚未赋值，用内部路径）
    return new Promise<void>((resolve, reject) => {
      const child = this.activeChild;
      if (!child || !child.stdin) {
        reject(new Error("no child"));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("ping timeout"));
      }, UIA_WORKER_PING_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
        timer,
      });
      child.stdin.write(`${JSON.stringify({ id, op: "ping", payload: {} })}\n`);
    });
  }

  private activeChild: ChildProcess | null = null;

  private attach(child: ChildProcess): void {
    this.activeChild = child;
    this.stdoutBuffer = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      if (this.activeChild !== child) return; // 旧进程的迟到输出：忽略
      this.onStdout(chunk);
    });
    child.stderr?.on("data", () => {
      /* stderr 丢弃：绝不回传 raw OS 信息 */
    });
    child.stdin?.on("error", () => {
      /* EPIPE 等：由 exit/超时路径统一收敛，避免 unhandled error 崩溃 Main */
    });
    // 旧进程（已被替换/回收）的 exit/error 不得影响新进程状态
    child.on("exit", () => {
      if (this.activeChild !== child) return;
      this.onExit();
    });
    child.on("error", () => {
      if (this.activeChild !== child) return;
      this.onExit();
    });
  }

  private onStdout(chunk: Buffer): void {
    this.stdoutBuffer += chunk.toString("utf8");
    if (this.stdoutBuffer.length > UIA_WORKER_MAX_OUTPUT_LINE * 4) {
      // 协议失控：重启，避免内存膨胀
      this.restart("output-overflow");
      return;
    }
    let newlineIndex = this.stdoutBuffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line) this.handleLine(line);
      newlineIndex = this.stdoutBuffer.indexOf("\n");
    }
  }

  private handleLine(line: string): void {
    let parsed: { id?: unknown; ok?: unknown; data?: unknown; error?: unknown };
    try {
      parsed = JSON.parse(line) as typeof parsed;
    } catch {
      return; // 非协议输出（防御性忽略）
    }
    const id = typeof parsed.id === "number" ? parsed.id : null;
    if (id === null) return;
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (parsed.ok === true) {
      pending.resolve(parsed.data);
    } else {
      pending.reject(
        new UiaWorkerRequestError(typeof parsed.error === "string" ? parsed.error : "worker-error")
      );
    }
  }

  private onExit(): void {
    this.child = null;
    this.activeChild = null;
    this.rejectAll(new UiaWorkerUnavailableError("worker exited"));
  }

  private rejectAll(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private restart(reason: string): void {
    this.unavailableReason = reason;
    this.stop(reason);
  }

  private stop(reason: string): void {
    const child = this.child ?? this.activeChild;
    this.child = null;
    this.activeChild = null;
    this.stdoutBuffer = "";
    this.rejectAll(new UiaWorkerUnavailableError(reason));
    if (!child) return;
    try {
      child.stdin?.end();
    } catch {
      /* ignore */
    }
    try {
      if (!child.killed) child.kill();
    } catch {
      /* ignore */
    }
  }
}

function defaultSpawn(): ChildProcess {
  // worker 脚本远超 Windows 命令行长度上限 → gzip + base64 + 内存解压执行（不写磁盘）
  const script = buildUiaWorkerScript();
  const compressed = gzipSync(Buffer.from(script, "utf8")).toString("base64");
  const bootstrap =
    `$b=[Convert]::FromBase64String('${compressed}');` +
    `$m=New-Object IO.MemoryStream(,$b);` +
    `$g=New-Object IO.Compression.GzipStream($m,[IO.Compression.CompressionMode]::Decompress);` +
    `$r=New-Object IO.StreamReader($g);` +
    `Invoke-Expression $r.ReadToEnd()`;
  const encoded = Buffer.from(bootstrap, "utf16le").toString("base64");
  return spawn(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      encoded,
    ],
    { windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] }
  );
}

let singleton: UiaWorker | null = null;

/** Main 进程单例（ipc/runtime 通过 uiaWorkerClient 使用） */
export function getUiaWorker(): UiaWorker {
  if (!singleton) singleton = new UiaWorker();
  return singleton;
}

/** App 退出时释放常驻进程 */
export function disposeUiaWorker(): void {
  if (singleton) {
    singleton.dispose();
    singleton = null;
  }
}
