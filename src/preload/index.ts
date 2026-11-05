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
 * invoke 超时表（防挂起网络/IO 使渲染器 promise 永不结算而卡死 UI）：
 * - 只给“内部有界”的通道设超时（值 ≥ 内部超时上限 + 余量），无超时即保持原行为；
 * - 以下三类永不设超时：开原生对话框的（pickDirectory/skill:import，用户选目录时间无界）、
 *   后台长任务的（syncNow 整库同步）、纯事件订阅。
 * - 超时只结束渲染器侧等待（Main 侧操作继续，最终结果以事件/下次查询为准），
 *   错误形状与 bridge 统一 { code: "TIMEOUT" }。
 */
const INVOKE_TIMEOUTS_MS: Record<string, number> = {
  "window:isMaximized": 15_000,
  // fs（本地 IO；64MB 上限内秒级完成）
  "bridge:fs:list": 60_000,
  "bridge:fs:getGrantStatus": 30_000,
  "bridge:fs:forgetGrant": 30_000,
  "bridge:fs:stat": 60_000,
  "bridge:fs:readText": 60_000,
  "bridge:fs:readBytes": 60_000,
  "bridge:fs:readTextPrefix": 60_000,
  "bridge:fs:createDirectory": 60_000,
  "bridge:fs:writeText": 60_000,
  "bridge:fs:writeBytes": 60_000,
  "bridge:fs:remove": 60_000,
  "bridge:fs:move": 60_000,
  // terminal（execute 内部上限 120s；其余秒级）
  "bridge:terminal:execute": 150_000,
  "bridge:terminal:cancel": 30_000,
  "bridge:terminal:start": 60_000,
  "bridge:terminal:write": 30_000,
  "bridge:terminal:createSession": 30_000,
  "bridge:terminal:writeSession": 30_000,
  "bridge:terminal:resizeSession": 30_000,
  "bridge:terminal:closeSession": 30_000,
  // computer（observe/动作秒级；审批等待走事件流，不占 invoke）
  "bridge:computer:capabilities": 30_000,
  "bridge:computer:observe": 90_000,
  "bridge:computer:prepareAction": 60_000,
  "bridge:computer:action": 60_000,
  "bridge:computer:cancelActions": 60_000,
  "bridge:computer:listWindows": 30_000,
  "bridge:computer:findElements": 30_000,
  "bridge:computer:activateWindow": 60_000,
  "bridge:computer:openApplication": 60_000,
  "bridge:computer:getSessionStatus": 30_000,
  "bridge:computer:pauseSession": 30_000,
  "bridge:computer:resumeSession": 30_000,
  "bridge:computer:completeSession": 30_000,
  "bridge:computer:setSessionState": 30_000,
  "bridge:computer:updateSessionPlan": 30_000,
  "bridge:computer:buildSkillDraft": 30_000,
  // credentials（本地 vault，秒级）
  "bridge:credential:create": 30_000,
  "bridge:credential:replace": 30_000,
  "bridge:credential:delete": 30_000,
  "bridge:credential:list": 30_000,
  // skills（本地文件；import 开目录选择器，无界，不设）
  "bridge:skill:list": 30_000,
  "bridge:skill:get": 30_000,
  "bridge:skill:create": 60_000,
  "bridge:skill:update": 60_000,
  "bridge:skill:delete": 60_000,
  "bridge:skill:setEnabled": 30_000,
  "bridge:skill:export": 60_000,
  "bridge:skill:test": 90_000,
  "bridge:skill:activate": 30_000,
  // mcp（内部调用上限 30s）
  "bridge:mcp:list": 30_000,
  "bridge:mcp:add": 30_000,
  "bridge:mcp:test": 60_000,
  "bridge:mcp:connect": 60_000,
  "bridge:mcp:disconnect": 30_000,
  "bridge:mcp:remove": 30_000,
  "bridge:mcp:setEnabled": 30_000,
  "bridge:mcp:searchTools": 60_000,
  "bridge:mcp:callTool": 60_000,
  "bridge:mcp:approveAndCall": 60_000,
  // invocation（本地签发，秒级）
  "bridge:invocation:beginLocal": 30_000,
  "bridge:invocation:beginRemoteInbox": 30_000,
  "bridge:invocation:assertCapability": 30_000,
  // channels（内部 10s 级；OAuth 内部 180s；syncNow 后台长任务不设）
  "bridge:channels:list": 30_000,
  "bridge:channels:addQQ": 60_000,
  "bridge:channels:addQQMail": 60_000,
  "bridge:channels:update": 30_000,
  "bridge:channels:setEnabled": 30_000,
  "bridge:channels:connect": 60_000,
  "bridge:channels:disconnect": 30_000,
  "bridge:channels:test": 60_000,
  "bridge:channels:remove": 30_000,
  "bridge:channels:prepareReply": 30_000,
  "bridge:channels:confirmReply": 60_000,
  "bridge:channels:cancelReply": 30_000,
  "bridge:channels:canReply": 30_000,
  "bridge:channels:startGmailOAuth": 200_000,
  "bridge:channels:cancelGmailOAuth": 30_000,
  // inbox（本地队列，秒级）
  "bridge:inbox:rendererReady": 30_000,
  "bridge:inbox:ack": 30_000,
  // mini（send 的 Main 侧上限 90s；其余秒级）
  "mini:send": 120_000,
  "mini:is-always-on-top": 30_000,
  "mini:get-window-state": 30_000,
  "mini:get-state": 30_000,
};

/**
 * Bridge IPC 调用封装：
 * - 主进程统一抛 Error（message 内 JSON 编码 { code, message? }）
 * - 这里解析并重构为 { code, message? }，保证 Web 侧（lib/desktop/bridge.ts）
 *   读到的 err.code 就是合同定义的错误码
 */
/** P2：幂等读通道单飞（slash 每键 bridge.list() 等高频并发同参去重；写通道不进单飞） */
const SINGLE_FLIGHT_CHANNELS = new Set([
  "bridge:skill:list",
  "bridge:channels:list",
  "bridge:mcp:list",
  "bridge:computer:capabilities",
  "bridge:computer:listWindows",
  "bridge:fs:list",
  "bridge:fs:stat",
]);
const inflightInvokes = new Map<string, Promise<unknown>>();
function inflightKey(channel: string, input: unknown): string {
  try {
    return `${channel}::${JSON.stringify(input ?? null).slice(0, 512)}`;
  } catch {
    return `${channel}::unserializable`;
  }
}
async function invokeBridge(channel: string, input: unknown): Promise<unknown> {
  const timeoutMs = INVOKE_TIMEOUTS_MS[channel];
  const rawInvoke = async (): Promise<unknown> => {
    // 单飞只拦并发同参（串行调用仍每次真实 IPC，不引入 stale）
    if (!SINGLE_FLIGHT_CHANNELS.has(channel)) {
      try {
        return await ipcRenderer.invoke(channel, input);
      } catch (err) {
        throw normalizeInvokeError(err);
      }
    }
    const key = inflightKey(channel, input);
    const existing = inflightInvokes.get(key);
    if (existing) return existing;
    const p = (async () => {
      try {
        return await ipcRenderer.invoke(channel, input);
      } catch (err) {
        throw normalizeInvokeError(err);
      } finally {
        inflightInvokes.delete(key);
      }
    })();
    inflightInvokes.set(key, p);
    return p;
  };
  if (!timeoutMs) return rawInvoke();
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      rawInvoke(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(JSON.stringify({ code: "TIMEOUT", message: "请求超时，请重试。" })));
        }, timeoutMs);
      }),
    ]);
  } catch (err) {
    throw normalizeInvokeError(err);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizeInvokeError(err: unknown): { code: string; message?: string } {
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

/**
 * Computer Use Phase 1+2+3：Desktop Observe + Action + Session Bridge。
 * 只暴露结构化 API（capabilities / observe / prepareAction / action / cancelActions /
 * listWindows / activateWindow / openApplication / session 生命周期）；
 * 不暴露通用 IPC / native handle / HWND / PID。所有输入由 Main 执行。
 */
const computerBridge = {
  version: 3,
  capabilities: () => invokeBridge("bridge:computer:capabilities", {}),
  observe: (input: unknown) => invokeBridge("bridge:computer:observe", input),
  prepareAction: (input: unknown) => invokeBridge("bridge:computer:prepareAction", input),
  action: (input: unknown) => invokeBridge("bridge:computer:action", input),
  cancelActions: (input: unknown) => invokeBridge("bridge:computer:cancelActions", input),
  listWindows: (input: unknown) => invokeBridge("bridge:computer:listWindows", input),
  findElements: (input: unknown) => invokeBridge("bridge:computer:findElements", input),
  activateWindow: (input: unknown) => invokeBridge("bridge:computer:activateWindow", input),
  openApplication: (input: unknown) => invokeBridge("bridge:computer:openApplication", input),
  getSessionStatus: (input: unknown) => invokeBridge("bridge:computer:getSessionStatus", input),
  pauseSession: (input: unknown) => invokeBridge("bridge:computer:pauseSession", input),
  resumeSession: (input: unknown) => invokeBridge("bridge:computer:resumeSession", input),
  completeSession: (input: unknown) => invokeBridge("bridge:computer:completeSession", input),
  setSessionState: (input: unknown) => invokeBridge("bridge:computer:setSessionState", input),
  updateSessionPlan: (input: unknown) => invokeBridge("bridge:computer:updateSessionPlan", input),
  buildSkillDraft: (input: unknown) => invokeBridge("bridge:computer:buildSkillDraft", input),
  subscribeSession: (listener: (event: unknown) => void): (() => void) => {
    const handler = (_e: unknown, event: unknown) => listener(event);
    ipcRenderer.on("bridge:computer:session-event", handler);
    return () => ipcRenderer.removeListener("bridge:computer:session-event", handler);
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
  // importPath 已移除：renderer 可传任意路径的目录拷贝 = 绕过 fs grant 模型的攻击面
  //（稳定性审计 BUG-037；无生产调用方）。导入统一走 bridge:skill:import 的原生目录选择器。
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
  addQQMail: (input: unknown) => invokeBridge("bridge:channels:addQQMail", input),
  update: (input: unknown) => invokeBridge("bridge:channels:update", input),
  setEnabled: (input: unknown) => invokeBridge("bridge:channels:setEnabled", input),
  connect: (input: unknown) => invokeBridge("bridge:channels:connect", input),
  disconnect: (input: unknown) => invokeBridge("bridge:channels:disconnect", input),
  test: (input: unknown) => invokeBridge("bridge:channels:test", input),
  remove: (input: unknown) => invokeBridge("bridge:channels:remove", input),
  prepareReply: (input: unknown) => invokeBridge("bridge:channels:prepareReply", input),
  confirmReply: (input: unknown) => invokeBridge("bridge:channels:confirmReply", input),
  cancelReply: (input: unknown) => invokeBridge("bridge:channels:cancelReply", input),
  canReply: (input: unknown) => invokeBridge("bridge:channels:canReply", input),
  startGmailOAuth: () => invokeBridge("bridge:channels:startGmailOAuth", {}),
  cancelGmailOAuth: () => invokeBridge("bridge:channels:cancelGmailOAuth", {}),
  syncNow: (input: unknown) => invokeBridge("bridge:channels:syncNow", input),
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

/**
 * Kiro Mini 常驻窗桥（thin relay；聊天真相在主窗口，Mini 只做快照展示 + 发送意图）。
 * - 主窗口侧：show/hide/toggle + onRemoteSend/completeRemoteSend/onRemoteStop + publishState
 * - Mini 窗侧：sendRemote/stopRemote + getState/onState/isAlwaysOnTop/setAlwaysOnTop/hide
 * 同一 bridge 双向复用（sender 角色由 Main 校验，preload 不做信任判定）。
 */
const miniBridge = {
  show: () => ipcRenderer.send("mini:show"),
  hide: () => ipcRenderer.send("mini:hide"),
  toggle: () => ipcRenderer.send("mini:toggle"),
  setAlwaysOnTop: (onTop: boolean) => ipcRenderer.send("mini:set-always-on-top", { onTop }),
  isAlwaysOnTop: (): Promise<{ onTop: boolean }> => ipcRenderer.invoke("mini:is-always-on-top"),
  setMode: (mode: "expanded" | "capsule", instant?: boolean) =>
    ipcRenderer.send("mini:set-mode", { mode, instant: instant === true }),
  getWindowState: (): Promise<{ mode: "expanded" | "capsule"; onTop: boolean }> =>
    ipcRenderer.invoke("mini:get-window-state"),
  sendRemote: (payload: unknown) => invokeBridge("mini:send", payload),
  stopRemote: () => ipcRenderer.send("mini:stop"),
  newChat: () => ipcRenderer.send("mini:new-chat"),
  switchConversation: (conversationId: string) =>
    ipcRenderer.send("mini:switch-conversation", { conversationId }),
  focusMain: (conversationId?: string) =>
    ipcRenderer.send("mini:focus-main", conversationId ? { conversationId } : {}),
  resolveApproval: (approvalId: string, decision: "deny" | "allow-once") =>
    ipcRenderer.send("mini:approve", { approvalId, decision }),
  publishState: (snapshot: unknown) => ipcRenderer.send("mini:publish-state", snapshot),
  getState: (): Promise<unknown> => ipcRenderer.invoke("mini:get-state"),
  onState: (callback: (snapshot: unknown) => void): (() => void) => {
    const handler = (_e: unknown, snapshot: unknown) => callback(snapshot);
    ipcRenderer.on("mini:state", handler);
    return () => ipcRenderer.removeListener("mini:state", handler);
  },
  onRemoteSend: (callback: (payload: unknown) => void): (() => void) => {
    const handler = (_e: unknown, payload: unknown) => callback(payload);
    ipcRenderer.on("mini:remote-send", handler);
    return () => ipcRenderer.removeListener("mini:remote-send", handler);
  },
  completeRemoteSend: (result: unknown) => ipcRenderer.send("mini:remote-send:done", result),
  onRemoteStop: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on("mini:remote-stop", handler);
    return () => ipcRenderer.removeListener("mini:remote-stop", handler);
  },
  onRemoteNewChat: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on("mini:remote-new-chat", handler);
    return () => ipcRenderer.removeListener("mini:remote-new-chat", handler);
  },
  onRemoteSwitchConversation: (callback: (conversationId: string) => void): (() => void) => {
    const handler = (_e: unknown, payload: { conversationId?: unknown } | null) => {
      if (typeof payload?.conversationId === "string") callback(payload.conversationId);
    };
    ipcRenderer.on("mini:remote-switch-conversation", handler);
    return () => ipcRenderer.removeListener("mini:remote-switch-conversation", handler);
  },
  onRemoteFocusConversation: (callback: (conversationId: string) => void): (() => void) => {
    const handler = (_e: unknown, payload: { conversationId?: unknown } | null) => {
      if (typeof payload?.conversationId === "string") callback(payload.conversationId);
    };
    ipcRenderer.on("mini:remote-focus-conversation", handler);
    return () => ipcRenderer.removeListener("mini:remote-focus-conversation", handler);
  },
  onRemoteApproval: (
    callback: (payload: { approvalId: string; decision: "deny" | "allow-once" }) => void
  ): (() => void) => {
    const handler = (
      _e: unknown,
      payload: { approvalId?: unknown; decision?: unknown } | null
    ) => {
      if (typeof payload?.approvalId !== "string") return;
      const decision = payload.decision === "deny" ? "deny" : "allow-once";
      callback({ approvalId: payload.approvalId, decision });
    };
    ipcRenderer.on("mini:remote-approval", handler);
    return () => ipcRenderer.removeListener("mini:remote-approval", handler);
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
  computer: computerBridge,
  credentials: credentialsBridge,
  skills: skillBridge,
  mcp: mcpBridge,
  invocation: invocationBridge,
  channels: channelsBridge,
  inbox: inboxBridge,
  mini: miniBridge,
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
