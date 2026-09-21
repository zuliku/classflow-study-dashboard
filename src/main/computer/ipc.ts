/**
 * Computer Use Phase 1 — Desktop Computer IPC（Electron Main）。
 *
 * 通道（全部经 trusted sender validation）：
 * - bridge:computer:capabilities → 运行时能力（不触发截图 / UIA）
 * - bridge:computer:observe      → 只读桌面观察
 *
 * 安全：
 * - preload 只暴露 capabilities / observe 两个结构化 API
 * - 结构化错误（{ code, message } JSON 编码）；绝不含 OS stack / absolute path / HWND / PID
 * - 定时清理过期 Observation（含 elementId → native 映射；unref，不阻塞退出）
 */
import { ipcMain, BrowserWindow } from "electron";
import { validateIpcSender } from "@/lib/security/ipcSender";
import type { ClassFlowDesktopComputerCapabilities } from "@/lib/desktop/types";
import { DesktopComputerIpcError } from "./observation";
import { getDesktopObservationRuntime } from "./runtime";

export interface ComputerIpcOptions {
  getAllowedOrigins?: () => { allowedApiOrigin: string; allowedDevOrigin?: string };
  isTrustedSender?: (sender: Electron.WebContents) => boolean;
}

const OBSERVATION_SWEEP_INTERVAL_MS = 30_000;
let sweepTimer: NodeJS.Timeout | null = null;

function withValidation<T extends unknown[]>(
  channel: string,
  handler: (event: Electron.IpcMainInvokeEvent, ...args: T) => unknown,
  opts?: ComputerIpcOptions
): (event: Electron.IpcMainInvokeEvent, ...args: T) => unknown {
  return (event, ...args) => {
    const sender = event.sender;
    const destroyed = (() => {
      try {
        return sender.isDestroyed();
      } catch {
        return true;
      }
    })();
    const isTrustedWindow = opts?.isTrustedSender ? opts.isTrustedSender(sender) : !destroyed;
    const url = (() => {
      try {
        return sender.getURL();
      } catch {
        return "";
      }
    })();
    const origins = opts?.getAllowedOrigins ? opts.getAllowedOrigins() : {};
    const result = validateIpcSender(channel, { destroyed, isTrustedWindow, url }, origins);
    if (!result.ok) {
      console.warn(`[classflow] IPC denied ${channel}: ${result.reason}`);
      throw new Error(JSON.stringify({ code: "PERMISSION_DENIED", message: result.reason }));
    }
    return handler(event, ...args);
  };
}

/** Bridge 错误 → IPC Error（preload 解析 message 内 JSON） */
function encodeBridgeError(err: unknown): Error {
  if (err instanceof DesktopComputerIpcError) {
    return new Error(JSON.stringify({ code: err.code, message: err.message }));
  }
  return new Error(JSON.stringify({ code: "OBSERVATION_FAILED", message: "桌面观察失败" }));
}

const UNAVAILABLE_CAPABILITIES: ClassFlowDesktopComputerCapabilities = {
  available: false,
  platform: "unknown",
  screenshot: false,
  uiAutomation: false,
  action: false,
  session: false,
  appControl: false,
};

/** Session 事件 → 所有 renderer 窗口（已脱敏；UI-only） */
function broadcastSessionEvent(event: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    try {
      window.webContents.send("bridge:computer:session-event", event);
    } catch {
      /* 单个窗口发送失败忽略 */
    }
  }
}

export function registerComputerIpc(opts?: ComputerIpcOptions): void {
  const wrap = <T extends unknown[]>(
    channel: string,
    handler: (event: Electron.IpcMainInvokeEvent, ...args: T) => unknown
  ) => withValidation(channel, handler, opts);

  ipcMain.handle(
    "bridge:computer:capabilities",
    wrap("bridge:computer:capabilities", async () => {
      try {
        return await (await getDesktopObservationRuntime()).capabilities();
      } catch {
        return UNAVAILABLE_CAPABILITIES;
      }
    })
  );

  ipcMain.handle(
    "bridge:computer:observe",
    wrap("bridge:computer:observe", async (_event, input: unknown) => {
      try {
        return await (await getDesktopObservationRuntime()).observe(input);
      } catch (err) {
        throw encodeBridgeError(err);
      }
    })
  );

  ipcMain.handle(
    "bridge:computer:prepareAction",
    wrap("bridge:computer:prepareAction", async (_event, input: unknown) => {
      try {
        return await (await getDesktopObservationRuntime()).prepareAction(input);
      } catch (err) {
        throw encodeBridgeError(err);
      }
    })
  );

  ipcMain.handle(
    "bridge:computer:action",
    wrap("bridge:computer:action", async (_event, input: unknown) => {
      try {
        return await (await getDesktopObservationRuntime()).action(input);
      } catch (err) {
        throw encodeBridgeError(err);
      }
    })
  );

  ipcMain.handle(
    "bridge:computer:cancelActions",
    wrap("bridge:computer:cancelActions", async (_event, input: unknown) => {
      try {
        return (await getDesktopObservationRuntime()).cancelActions(input);
      } catch (err) {
        throw encodeBridgeError(err);
      }
    })
  );

  // Computer Use Phase 3：多窗口 / 应用控制 / Session 生命周期
  const sessionHandlers = [
    "listWindows",
    "activateWindow",
    "openApplication",
    "getSessionStatus",
    "pauseSession",
    "resumeSession",
    "completeSession",
    "setSessionState",
  ] as const;
  for (const method of sessionHandlers) {
    ipcMain.handle(
      `bridge:computer:${method}`,
      wrap(`bridge:computer:${method}`, async (_event, input: unknown) => {
        try {
          const runtime = await getDesktopObservationRuntime();
          const fn = runtime[method] as (raw: unknown) => unknown;
          return await fn.call(runtime, input);
        } catch (err) {
          throw encodeBridgeError(err);
        }
      })
    );
  }

  // Session 状态事件（UI-only；sanitized）
  void getDesktopObservationRuntime().then((runtime) => {
    runtime.setSessionEventSink((event) => broadcastSessionEvent(event));
  });

  // 短 TTL 清理（unref：不阻止进程退出；重复注册时替换旧 timer）
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
  sweepTimer = setInterval(() => {
    void getDesktopObservationRuntime().then((runtime) => runtime.sweepObservations());
  }, OBSERVATION_SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
}
