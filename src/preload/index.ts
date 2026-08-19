import { contextBridge, ipcRenderer } from "electron";

/** 主进程通过 additionalArguments 注入本地 API 地址（生产/开发统一走本地 HTTP server） */
function resolveApiBase(): string {
  const prefix = "--classflow-api-base=";
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : "";
}

/**
 * Bridge IPC 调用封装：
 * - 主进程统一抛 Error（message 内 JSON 编码 { code, message? }）
 * - 这里解析并重构为 { code, message? }，保证 Web 侧（lib/desktop/bridge.ts）
 *   读到的 err.code 就是合同定义的错误码
 */
async function invokeBridge(channel: string, input: unknown): Promise<unknown> {
  try {
    return await ipcRenderer.invoke(channel, input);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    // Electron 会给 invoke 错误加前缀："Error invoking remote method 'xxx': <message>"
    const jsonMatch = raw.match(/\{[^{}]*\}/);
    const payload = jsonMatch ? jsonMatch[0] : raw;
    let code = "IO_ERROR";
    let message: string | undefined;
    try {
      const parsed = JSON.parse(payload) as { code?: unknown; message?: unknown };
      if (typeof parsed?.code === "string") {
        code = parsed.code;
        if (typeof parsed.message === "string") message = parsed.message;
      }
    } catch {
      /* 非 JSON 错误信息：保留 IO_ERROR */
    }
    throw { code, message };
  }
}

const filesystemBridge = {
  pickDirectory: (input: unknown) => invokeBridge("bridge:fs:pickDirectory", input),
  getGrantStatus: (input: unknown) => invokeBridge("bridge:fs:getGrantStatus", input),
  forgetGrant: (input: unknown) => invokeBridge("bridge:fs:forgetGrant", input),
  list: (input: unknown) => invokeBridge("bridge:fs:list", input),
  stat: (input: unknown) => invokeBridge("bridge:fs:stat", input),
  readText: (input: unknown) => invokeBridge("bridge:fs:readText", input),
  readBytes: (input: unknown) => invokeBridge("bridge:fs:readBytes", input),
  readTextPrefix: (input: unknown) => invokeBridge("bridge:fs:readTextPrefix", input),
  createDirectory: (input: unknown) => invokeBridge("bridge:fs:createDirectory", input),
  writeText: (input: unknown) => invokeBridge("bridge:fs:writeText", input),
  writeBytes: (input: unknown) => invokeBridge("bridge:fs:writeBytes", input),
  remove: (input: unknown) => invokeBridge("bridge:fs:remove", input),
  move: (input: unknown) => invokeBridge("bridge:fs:move", input),
};

const terminalBridge = {
  version: 2,
  // V1 向后兼容（Command Runner 语义不变）
  execute: (input: unknown) => invokeBridge("bridge:terminal:execute", input),
  cancel: (input: unknown) => invokeBridge("bridge:terminal:cancel", input),
  // V2：流式启动 + 事件订阅（事件已 sanitized；sequence 单调递增）
  start: (input: unknown) => invokeBridge("bridge:terminal:start", input),
  subscribe: (listener: (event: unknown) => void): (() => void) => {
    const handler = (_e: unknown, event: unknown) => listener(event);
    ipcRenderer.on("bridge:terminal:event", handler);
    return () => ipcRenderer.removeListener("bridge:terminal:event", handler);
  },
  // V3 Phase 3：受控 stdin write（execution 必须 active；size/rate bounded）
  write: (input: unknown) => invokeBridge("bridge:terminal:write", input),
  // V2 Phase 4：持久 PowerShell PTY Session（渐进能力）
  createSession: (input: unknown) => invokeBridge("bridge:terminal:createSession", input),
  writeSession: (input: unknown) => invokeBridge("bridge:terminal:writeSession", input),
  resizeSession: (input: unknown) => invokeBridge("bridge:terminal:resizeSession", input),
  closeSession: (input: unknown) => invokeBridge("bridge:terminal:closeSession", input),
  subscribeSession: (listener: (event: unknown) => void): (() => void) => {
    const handler = (_e: unknown, event: unknown) => listener(event);
    ipcRenderer.on("bridge:terminal:session-event", handler);
    return () => ipcRenderer.removeListener("bridge:terminal:session-event", handler);
  },
};

contextBridge.exposeInMainWorld("classflowDesktop", {
  version: 1,
  platform: "windows",
  apiBase: resolveApiBase(),
  window: {
    minimize: () => ipcRenderer.send("window:minimize"),
    toggleMaximize: () => ipcRenderer.send("window:maximize"),
    close: () => ipcRenderer.send("window:close"),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke("window:isMaximized"),
    onMaximizedChange: (callback: (maximized: boolean) => void): (() => void) => {
      const listener = (_e: unknown, maximized: boolean) => callback(maximized);
      ipcRenderer.on("window:maximized-changed", listener);
      return () => ipcRenderer.removeListener("window:maximized-changed", listener);
    },
  },
  filesystem: filesystemBridge,
  terminal: terminalBridge,
});
