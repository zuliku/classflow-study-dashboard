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

export interface ClassFlowDesktopBridgeV1 {
  version: typeof CLASSFLOW_DESKTOP_BRIDGE_VERSION;
  platform: ClassFlowDesktopPlatform;
  filesystem: ClassFlowDesktopFilesystemBridgeV1;
}

declare global {
  interface Window {
    /** Desktop Runtime 注入的唯一入口；Web 只通过 lib/desktop/bridge.ts 访问 */
    classflowDesktop?: ClassFlowDesktopBridgeV1;
  }
}
