import { contextBridge, ipcRenderer } from "electron";

/** 主进程通过 additionalArguments 注入本地 API 地址（生产/开发统一走本地 HTTP server） */
function resolveApiBase(): string {
  const prefix = "--classflow-api-base=";
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : "";
}

/** 主进程通过 additionalArguments 注入 per-launch capability（随机 token，Renderer 不直接暴露给业务组件） */
function resolveApiCapability(): string {
  const prefix = "--classflow-api-capability=";
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : "";
}

// 闭包保存 capability，不暴露到 window，统一通过 api.request 自动附加
const apiCapability = resolveApiCapability();

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

// Credentials Bridge — 仅允许受限的 4 个操作（创建/替换/删除/列表），不暴露明文读取
const credentialsBridge = {
  create: (input: unknown) => invokeBridge("bridge:credential:create", input),
  replace: (input: unknown) => invokeBridge("bridge:credential:replace", input),
  delete: (input: unknown) => invokeBridge("bridge:credential:delete", input),
  list: (input: unknown) => invokeBridge("bridge:credential:list", input),
};

const skillBridge = {
  list: (input?: unknown) => invokeBridge("bridge:skill:list", input ?? {}),
  get: (input: unknown) => invokeBridge("bridge:skill:get", input),
  create: (input: unknown) => invokeBridge("bridge:skill:create", input),
  update: (input: unknown) => invokeBridge("bridge:skill:update", input),
  delete: (input: unknown) => invokeBridge("bridge:skill:delete", input),
  setEnabled: (input: unknown) => invokeBridge("bridge:skill:setEnabled", input),
  import: () => invokeBridge("bridge:skill:import", {}),
  importPath: (input: unknown) => invokeBridge("bridge:skill:importPath", input),
  export: (input: unknown) => invokeBridge("bridge:skill:export", input),
  test: (input: unknown) => invokeBridge("bridge:skill:test", input),
  activate: (input: unknown) => invokeBridge("bridge:skill:activate", input),
};

const mcpBridge = {
  list: () => invokeBridge("bridge:mcp:list", {}),
  add: (input: unknown) => invokeBridge("bridge:mcp:add", input),
  test: (input: unknown) => invokeBridge("bridge:mcp:test", input),
  connect: (input: unknown) => invokeBridge("bridge:mcp:connect", input),
  disconnect: (input: unknown) => invokeBridge("bridge:mcp:disconnect", input),
  remove: (input: unknown) => invokeBridge("bridge:mcp:remove", input),
  setEnabled: (input: unknown) => invokeBridge("bridge:mcp:setEnabled", input),
  searchTools: (input: unknown) => invokeBridge("bridge:mcp:searchTools", input),
  callTool: (input: unknown) => invokeBridge("bridge:mcp:callTool", input),
  approveAndCall: (input: unknown) => invokeBridge("bridge:mcp:approveAndCall", input),
};

const invocationBridge = {
  beginLocal: () => invokeBridge("bridge:invocation:beginLocal", {}),
  beginRemoteInbox: (input: unknown) => invokeBridge("bridge:invocation:beginRemoteInbox", input),
  assertCapability: (input: unknown) => invokeBridge("bridge:invocation:assertCapability", input),
};

const channelsBridge = {
  list: () => invokeBridge("bridge:channels:list", {}),
  addQQ: (input: unknown) => invokeBridge("bridge:channels:addQQ", input),
  update: (input: unknown) => invokeBridge("bridge:channels:update", input),
  setEnabled: (input: unknown) => invokeBridge("bridge:channels:setEnabled", input),
  connect: (input: unknown) => invokeBridge("bridge:channels:connect", input),
  disconnect: (input: unknown) => invokeBridge("bridge:channels:disconnect", input),
  test: (input: unknown) => invokeBridge("bridge:channels:test", input),
  remove: (input: unknown) => invokeBridge("bridge:channels:remove", input),
};

const inboxBridge = {
  subscribeExternalItem: (callback: (envelope: unknown) => void): (() => void) => {
    const handler = (_e: unknown, envelope: unknown) => callback(envelope);
    ipcRenderer.on("bridge:inbox:externalItem", handler);
    return () => ipcRenderer.removeListener("bridge:inbox:externalItem", handler);
  },
  rendererReady: () => invokeBridge("bridge:inbox:rendererReady", {}),
  ack: (deliveryId: string) => invokeBridge("bridge:inbox:ack", { deliveryId }),
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
  credentials: credentialsBridge,
  skills: skillBridge,
  mcp: mcpBridge,
  invocation: invocationBridge,
  channels: channelsBridge,
  inbox: inboxBridge,
  api: {
    request: async (path: string, init?: RequestInit): Promise<Response> => {
      const base = resolveApiBase();
      const url = `${base}${path}`;
      const headers = new Headers(init?.headers);
      // per-launch capability 自动附加，不暴露给普通业务组件
      if (apiCapability) {
        headers.set("x-classflow-capability", apiCapability);
      }
      const mergedInit: RequestInit = { ...init, headers };
      return fetch(url, mergedInit);
    },
  },
});
