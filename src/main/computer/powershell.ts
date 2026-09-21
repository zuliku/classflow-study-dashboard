/**
 * Computer Use Phase 1 — PowerShell 探测执行器（Electron Main / Node 侧）。
 *
 * 只用于只读桌面元数据采集（窗口枚举 / UI Automation 控件树探测）：
 * - 不依赖 electron API（可在 Vitest node 环境直接测试）
 * - 强制 UTF-8 输出、NonInteractive、windowsHide、不 elevation
 * - 超时 → 终止整个 process tree；stdout/stderr bounded
 * - 不回传 raw OS error / absolute path
 */
import { spawn, ChildProcess } from "node:child_process";

export const POWERSHELL_PROBE_TIMEOUT_MS = 12_000;
export const POWERSHELL_MAX_OUTPUT_BYTES = 1024 * 1024;

export class PowerShellProbeError extends Error {
  readonly code: "TIMEOUT" | "EXECUTION_FAILED" | "INVALID_OUTPUT";
  constructor(code: PowerShellProbeError["code"], message?: string) {
    super(message ?? code);
    this.name = "PowerShellProbeError";
    this.code = code;
  }
}

/** Windows：taskkill /T /F 终止整个 process tree */
function killProcessTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    const killer = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true });
    killer.on("close", () => resolve());
    killer.on("error", () => resolve());
    setTimeout(() => resolve(), 3000);
  });
}

/**
 * 以 -EncodedCommand 执行 PowerShell 脚本（避免 Windows 命令行引号/换行转义问题），
 * 返回解析后的 JSON。脚本必须自行输出 JSON（或空输出 → null）。
 */
export function runPowerShellJson<T>(
  script: string,
  timeoutMs: number = POWERSHELL_PROBE_TIMEOUT_MS
): Promise<T> {
  const bootstrap =
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; " +
    "$ProgressPreference = 'SilentlyContinue'; " +
    "$ErrorActionPreference = 'Stop'; ";
  const encoded = Buffer.from(bootstrap + script, "utf16le").toString("base64");

  return new Promise<T>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(
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
        { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] }
      );
    } catch {
      reject(new PowerShellProbeError("EXECUTION_FAILED"));
      return;
    }

    let settled = false;
    let stdout = "";
    let stdoutTruncated = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length >= POWERSHELL_MAX_OUTPUT_BYTES) {
        stdoutTruncated = true;
        return;
      }
      const room = POWERSHELL_MAX_OUTPUT_BYTES - stdout.length;
      stdout += chunk.toString("utf8", 0, Math.min(chunk.length, room));
      if (chunk.length > room) stdoutTruncated = true;
    });
    child.stderr?.on("data", () => {
      /* stderr 丢弃：绝不回传 raw OS 信息 */
    });

    const timer = setTimeout(() => {
      finish(() => {
        void killProcessTree(child.pid ?? 0);
        reject(new PowerShellProbeError("TIMEOUT"));
      });
    }, timeoutMs);

    child.on("error", () => {
      finish(() => reject(new PowerShellProbeError("EXECUTION_FAILED")));
    });
    child.on("close", (code) => {
      finish(() => {
        if (code !== 0) {
          reject(new PowerShellProbeError("EXECUTION_FAILED"));
          return;
        }
        const trimmed = stdout.trim();
        if (!trimmed) {
          resolve(null as T);
          return;
        }
        if (stdoutTruncated) {
          reject(new PowerShellProbeError("INVALID_OUTPUT", "probe output too large"));
          return;
        }
        try {
          resolve(JSON.parse(trimmed) as T);
        } catch {
          reject(new PowerShellProbeError("INVALID_OUTPUT"));
        }
      });
    });
  });
}
