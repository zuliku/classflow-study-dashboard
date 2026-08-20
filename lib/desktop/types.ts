/**
 * ClassFlow Desktop Bridge —— Web-facing Native Filesystem Contract（V1）。
 *
 * 本模块只定义「未来 Desktop Runtime 注入 Web 的稳定接口」：
 * - 不依赖 Electron / Tauri / Node（runtime-agnostic）
 * - 不传 / 不返回任何 absolute path（renderer 与 model 永远只见 grantId + relative path）
 * - 全部参数 structured-clone friendly（无 handle / DOM node / callback）
 *
 * 完整迁移契约见 docs/desktop-filesystem-bridge.md。
 */

/** 当前 Web 只支持 Bridge V1（版本协商；未知版本一律视为不可用，不做猜测兼容） */
export const CLASSFLOW_DESKTOP_BRIDGE_VERSION = 1 as const;

export type ClassFlowDesktopPlatform = "windows" | "macos" | "linux" | "unknown";

export type ClassFlowDesktopGrantAccess = "read-only" | "read-write";

/** Native grant 生命周期状态（runtime facts；不持久化到 Workspace metadata） */
export type DesktopGrantStatus = "granted" | "missing" | "denied" | "unavailable";

/** Desktop Bridge 结构化错误（绝不向 Web throw raw OS error / stack / absolute path） */
export type DesktopBridgeErrorCode =
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "PERMISSION_DENIED"
  | "DIRECTORY_NOT_EMPTY"
  | "INVALID_OPERATION"
  | "IO_ERROR";

export interface DesktopBridgeError {
  code: DesktopBridgeErrorCode;
  /** 可选：用户可读短说明（禁止包含 native path / stack） */
  message?: string;
}

/** Native 目录授权结果（grantId 是 opaque token；Web 永远不知道其背后的真实路径） */
export interface ClassFlowDesktopGrant {
  grantId: string;
  displayName: string;
  access: ClassFlowDesktopGrantAccess;
}

export interface ClassFlowDesktopFilesystemBridgeV1 {
  /** 用户手势授权的目录 picker（用户取消 → null；禁止返回 absolute path） */
  pickDirectory(input: {
    access: ClassFlowDesktopGrantAccess;
  }): Promise<ClassFlowDesktopGrant | null>;

  /** 查询授权状态（不触发任何系统权限 UI） */
  getGrantStatus(input: { grantId: string }): Promise<{
    status: Exclude<DesktopGrantStatus, "unavailable">;
  }>;

  /** 忘记授权映射（绝不删除真实目录内容） */
  forgetGrant(input: { grantId: string }): Promise<void>;

  list(input: { grantId: string; path: string }): Promise<
    Array<{ name: string; kind: "file" | "directory"; size: number }>
  >;

  stat(input: { grantId: string; path: string }): Promise<{
    kind: "file" | "directory";
    size: number;
    type?: string;
  } | null>;

  readText(input: { grantId: string; path: string }): Promise<string>;

  readBytes(input: { grantId: string; path: string }): Promise<Uint8Array>;

  /** bounded text prefix（实现必须按 byte prefix 读取；绝不先读全文再截断） */
  readTextPrefix(input: {
    grantId: string;
    path: string;
    maxBytes: number;
  }): Promise<{ text: string; truncated: boolean }>;

  createDirectory(input: { grantId: string; path: string }): Promise<"created" | "exists">;

  writeText(input: {
    grantId: string;
    path: string;
    content: string;
    type?: string;
  }): Promise<void>;

  writeBytes(input: {
    grantId: string;
    path: string;
    content: Uint8Array;
    type?: string;
  }): Promise<void>;

  remove(input: { grantId: string; path: string; kind: "file" | "directory" }): Promise<void>;

  move(input: { grantId: string; from: string; to: string }): Promise<void>;
}

export interface ClassFlowDesktopChannelsBridge {
  list: () => Promise<{ channels: unknown[] }>;
  addQQ: (input: unknown) => Promise<{ channel: unknown }>;
  update: (input: unknown) => Promise<{ channel: unknown }>;
  setEnabled: (input: unknown) => Promise<{ ok: boolean }>;
  connect: (input: unknown) => Promise<{ ok: boolean }>;
  disconnect: (input: unknown) => Promise<{ ok: boolean }>;
  test: (input: unknown) => Promise<{ ok: boolean; error?: string }>;
  remove: (input: unknown) => Promise<{ ok: boolean }>;
  prepareReply: (input: unknown) => Promise<{ approvalId: string; expiresAt: number; preview: { channel: string; conversationType: string; text: string } }>;
  confirmReply: (input: unknown) => Promise<{ ok: boolean; platformMessageId?: string }>;
  cancelReply: (input: unknown) => Promise<{ ok: boolean }>;
  canReply: (input: unknown) => Promise<{ ok: boolean; reason?: string }>;
}

export interface ClassFlowDesktopInboxBridge {
  subscribeExternalItem: (callback: (envelope: unknown) => void) => () => void;
  rendererReady: () => Promise<{ ok: boolean }>;
  ack: (deliveryId: string) => Promise<{ ok: boolean }>;
}

export interface ClassFlowDesktopBridgeV1 {
  version: typeof CLASSFLOW_DESKTOP_BRIDGE_VERSION;
  platform: ClassFlowDesktopPlatform;
  filesystem: ClassFlowDesktopFilesystemBridgeV1;
  /**
   * Optional Capability（V1.1）：Terminal Bridge。
   * Desktop Runtime 可以只有 filesystem（filesystem-only → 依旧 valid；terminal 不可用）。
   * Terminal 自己拥有 version（1=V1 Command Runner；2=Streaming/Lifecycle/stdin/Session）；
   * 版本协商独立于 Bridge version。
   */
  terminal?: ClassFlowDesktopTerminalBridge;
  channels?: ClassFlowDesktopChannelsBridge;
  inbox?: ClassFlowDesktopInboxBridge;
  credentials?: {
    create: (input: unknown) => Promise<{ credentialRef: string }>;
    replace: (input: unknown) => Promise<unknown>;
    delete: (input: unknown) => Promise<unknown>;
    list: () => Promise<{ metadata: unknown[] }>;
  };
  skills?: unknown;
  mcp?: unknown;
  invocation?: unknown;
  api?: { request: (path: string, init?: RequestInit) => Promise<Response> };
}

export type ClassFlowDesktopTerminalShell = "powershell" | "cmd";

/**
 * Terminal Bridge V1 Error Contract（Handoff 冻结；Desktop Runtime 只实现这 4 种 reject code）。
 * - 绝不 reject TIMEOUT：timeout 属于 process execution outcome（resolve timedOut=true），
 *   不是 Bridge transport failure。
 * - 错误对象绝不包含 absolute path / username / stack / raw OS error。
 */
export type DesktopTerminalBridgeErrorCode =
  | "PERMISSION_DENIED"
  | "CANCELLED"
  | "EXECUTION_FAILED"
  | "INVALID_OPERATION";

export interface DesktopTerminalBridgeError {
  code: DesktopTerminalBridgeErrorCode;
  message?: string;
}

/**
 * Desktop Terminal Bridge V1（Command Runner；不是 interactive PTY）。
 *
 * execute 语义（V1.0.1 冻结）：
 * - resolve：normal exit（exitCode=0）／ non-zero exit（exitCode=N）／ timeout（timedOut=true, exitCode=null）
 * - reject：permission/grant failure（PERMISSION_DENIED）／ 用户取消（CANCELLED）／
 *   runner 基础设施失败如 PowerShell 可执行文件缺失（EXECUTION_FAILED）／ 非法 bridge 操作（INVALID_OPERATION）
 *
 * 安全契约（详见 docs/desktop-filesystem-bridge.md §Terminal）：
 * - 只接受 grantId + relative cwd；绝不接受 absolute cwd（Runtime 负责 grantId → native root 映射）。
 * - Runtime MUST：每次执行验证 grant granted；cwd canonicalize 后必须位于 granted root 内；
 *   cancel/timeout 必须终止整个 process tree；stdout/stderr bounded；non-interactive；
 *   不 elevation / 不管理员 / 不开 shell window；错误不含 absolute path / stack。
 */
export interface ClassFlowDesktopTerminalBridgeV1 {
  version: 1;
  execute(input: {
    /** opaque execution id（Web 生成；cancel 用） */
    executionId: string;
    shell: ClassFlowDesktopTerminalShell;
    grantId: string;
    /** relative cwd（"" = root） */
    cwd: string;
    command: string;
    timeoutMs: number;
  }): Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    durationMs: number;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
  }>;
  cancel(input: { executionId: string }): Promise<void>;
}

/**
 * Terminal Runtime Event（V2 streaming；经 preload subscribe 推送给 renderer / UI）。
 * - sequence 单调递增（每 execution 从 1 起），保证 chunk 顺序可确定重建。
 * - 事件内容已经过 sanitization（ANSI strip / absolute path redaction / secret redaction / char bound）。
 * - 绝不含 OS pid / native absolute path / username / raw error。
 */
export type DesktopTerminalEvent =
  | {
      type: "started";
      executionId: string;
      sequence: number;
    }
  | {
      type: "stdout";
      executionId: string;
      sequence: number;
      text: string;
    }
  | {
      type: "stderr";
      executionId: string;
      sequence: number;
      text: string;
    }
  | {
      type: "exit";
      executionId: string;
      sequence: number;
      exitCode: number | null;
      timedOut: boolean;
      cancelled: boolean;
      durationMs: number;
    };

/** V2 execution mode：foreground 默认；long-running 必须显式（放宽 timeout 上限） */
export type DesktopTerminalExecutionMode = "foreground" | "long-running";

/** Desktop Terminal Bridge V2：向后兼容 V1（execute/cancel 语义不变）+ 流式 start/subscribe。
 *  Phase 3 增加 write；Phase 4 增加 createSession/writeSession/resizeSession/closeSession。 */
export interface ClassFlowDesktopTerminalBridgeV2 {
  version: 2;
  execute: ClassFlowDesktopTerminalBridgeV1["execute"];
  cancel: ClassFlowDesktopTerminalBridgeV1["cancel"];
  /** 流式启动：resolve 最终 bounded result（与 V1 execute 相同返回契约）；事件经 subscribe 推送 */
  start(input: {
    executionId: string;
    shell: ClassFlowDesktopTerminalShell;
    grantId: string;
    cwd: string;
    command: string;
    timeoutMs: number;
    executionMode?: DesktopTerminalExecutionMode;
  }): Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    durationMs: number;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
  }>;
  /** 订阅该 runtime 的 terminal 事件流；返回取消订阅函数 */
  subscribe(listener: (event: DesktopTerminalEvent) => void): () => void;
  /** 受控 stdin write（Phase 3）：execution 必须 active；size/rate bounded；结束/取消后 reject INVALID_OPERATION */
  write(input: { executionId: string; data: string }): Promise<void>;
  /** 持久 PowerShell PTY Session（Phase 4，渐进能力）：createSession → writeSession/resizeSession/closeSession */
  createSession?(input: {
    shell: ClassFlowDesktopTerminalShell;
    grantId: string;
    cwd: string;
    cols: number;
    rows: number;
  }): Promise<{ sessionId: string }>;
  writeSession?(input: { sessionId: string; data: string }): Promise<void>;
  resizeSession?(input: { sessionId: string; cols: number; rows: number }): Promise<void>;
  closeSession?(input: { sessionId: string }): Promise<void>;
  subscribeSession?(listener: (event: DesktopTerminalSessionEvent) => void): () => void;
}

/** PTY Session 事件（经 subscribe 的独立 session 事件通道；data 已 sanitized） */
export type DesktopTerminalSessionEvent =
  | { type: "data"; sessionId: string; data: string }
  | { type: "exit"; sessionId: string; exitCode: number };

export type ClassFlowDesktopTerminalBridge = ClassFlowDesktopTerminalBridgeV1 | ClassFlowDesktopTerminalBridgeV2;

declare global {
  interface Window {
    /** Desktop Runtime 注入的唯一入口；Web 只通过 lib/desktop/bridge.ts 访问 */
    classflowDesktop?: ClassFlowDesktopBridgeV1;
  }
}
