/**
 * IPC Sender Validation — Task 02
 * 统一校验敏感 IPC（bridge:fs:* / bridge:terminal:* / window:*）是否来自受信任 ClassFlow renderer。
 *
 * 约束：
 * - 不在几十个 ipcMain.handle 中复制验证
 * - 拒绝：未知 WebContents / 非 ClassFlow window / 非预期 origin / 已销毁 window
 * - 不依赖 Renderer 自称 "I am trusted"
 *
 * Web 侧提供同构的校验（用于 Vitest）；Electron Main 侧应直接复用此纯函数 + WebContents 事实。
 */

/** 受信任的 renderer 判定输入（Electron Main 传入真实 WebContents / URL 信息） */
export interface IpcSenderContext {
  /** sender 是否已销毁（isDestroyed） */
  destroyed: boolean;
  /** 是否来自当前受信任 ClassFlow window（BrowserWindow id / WebContents id 匹配） */
  isTrustedWindow: boolean;
  /** sender 的 URL / origin（空 = 未知，直接拒绝） */
  url?: string;
  /** sender 的 frame origin（可选加强校验） */
  origin?: string;
}

export type IpcChannel = string;

const SENSITIVE_PREFIXES = [
  "bridge:fs:",
  "bridge:terminal:",
  "bridge:credential:",
  "bridge:skill:",
  "bridge:mcp:",
  "bridge:channel:",
  "window:",
] as const;
const SENSITIVE_EXACT: ReadonlySet<string> = new Set([
  "bridge:fs:pickDirectory",
  "bridge:terminal:execute",
]);

function isSensitiveChannel(channel: string): boolean {
  if (SENSITIVE_EXACT.has(channel)) return true;
  return SENSITIVE_PREFIXES.some((p) => channel.startsWith(p));
}

/** 允许的内部协议/origin（最小集合） */
const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(["app:", "http:", "https:"]);

function isAllowedInternalUrl(rawUrl: string | undefined, allowedApiOrigin?: string): boolean {
  if (!rawUrl) return false;
  try {
    const parsed = new URL(rawUrl);
    // app:// bundle（生产）
    if (parsed.protocol === "app:") return true;
    // localhost API（需绑定到本次启动实际端口，而非任意 localhost）
    if (allowedApiOrigin) {
      if (rawUrl.startsWith(allowedApiOrigin)) return true;
    }
    // 开发环境 Vite dev origin（由调用方传入 allowedApiOrigin，此处不宽松信任所有 localhost）
    return false;
  } catch {
    return false;
  }
}

/**
 * 核心校验：纯函数，fail closed。
 * - 非敏感 channel：放行（不校验 sender；由业务自行决定）
 * - 敏感 channel：必须 destroyed===false && isTrustedWindow===true && url 属于受信任范围
 */
export function validateIpcSender(
  channel: IpcChannel,
  sender: IpcSenderContext,
  opts?: { allowedApiOrigin?: string; allowedDevOrigin?: string }
): { ok: true } | { ok: false; reason: string } {
  if (!isSensitiveChannel(channel)) {
    return { ok: true };
  }

  if (sender.destroyed) {
    return { ok: false, reason: "sender destroyed" };
  }
  if (!sender.isTrustedWindow) {
    return { ok: false, reason: "untrusted window" };
  }
  const url = sender.url ?? "";
  if (!url) {
    return { ok: false, reason: "missing url" };
  }

  // 处理 about:blank / file: / javascript: 等一律拒绝（仅允许 app: 与受信任的 http(s) origin）
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return { ok: false, reason: "malformed url" };
  }
  if (!ALLOWED_PROTOCOLS.has(protocol)) {
    return { ok: false, reason: `disallowed protocol: ${protocol}` };
  }
  // file: / javascript: / data: / vbscript: 已被 protocol 拒绝；再次显式拒绝不信任 origin
  if (protocol === "file:" || protocol === "javascript:" || protocol === "data:" || protocol === "vbscript:") {
    return { ok: false, reason: `blocked protocol: ${protocol}` };
  }

  // 受信任 URL 判定
  const isApp = url.startsWith("app://");
  const isAllowedApi = opts?.allowedApiOrigin ? url.startsWith(opts.allowedApiOrigin) : false;
  const isAllowedDev = opts?.allowedDevOrigin ? url.startsWith(opts.allowedDevOrigin) : false;
  if (isApp || isAllowedApi || isAllowedDev) {
    return { ok: true };
  }

  // 其他 https origin 一律不视为受信任 sender（外部链接应走 shell.openExternal，而非 IPC）
  return { ok: false, reason: `untrusted origin: ${url}` };
}

/** 便捷：是否需要校验（敏感 channel 才需） */
export function requiresSenderValidation(channel: string): boolean {
  return isSensitiveChannel(channel);
}
