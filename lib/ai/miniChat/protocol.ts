/**
 * Kiro 常驻 Mini 窗协议（纯逻辑，无 DOM / 无 IPC / 无 Store）：
 *
 * 架构（单运行时 + 主进程中继）：
 * - 聊天唯一真相仍在主窗口的 KiroSession/useKiroChat（Single mount 不动）；
 * - Mini 窗（独立 BrowserWindow，`?mini=1` 同包渲染）是瘦客户端：只读快照 + 文本/文件发送意图；
 * - 主进程做可信中继（mini:send → 主窗口执行 → mini:state 回推），附件以 base64 经 IPC 传输后
 *   在主窗口重建为 File，走既有 addFiles → send 全管线（含视觉/预算/快照绑定）。
 *
 * 本文件只定义 wire 形状 + 校验/裁剪纯函数；Main/Preload/Renderer 三侧共用。
 */

export const MINI_CHAT_PROTOCOL_VERSION = 1;

/** Mini 展示用消息（role + 纯文本；富卡片保留在主窗口，v1 不序列化） */
export interface MiniChatMessageView {
  id: string;
  role: "user" | "assistant";
  text: string;
}

export interface MiniChatAttachmentView {
  id: string;
  name: string;
  status: string;
}

/** 主窗口 → Mini 的只读快照（structured-clone 安全：仅 plain 数据） */
export interface MiniChatSnapshot {
  version: typeof MINI_CHAT_PROTOCOL_VERSION;
  conversationId: string | null;
  messages: MiniChatMessageView[];
  /** turnInFlight || streaming（发送禁用 + Stop 可见的唯一依据） */
  busy: boolean;
  streaming: boolean;
  attachments: MiniChatAttachmentView[];
  configured: boolean;
  updatedAt: number;
}

/** Mini → 主窗口的远端发送附件（base64；主窗口重建 File） */
export interface MiniRemoteFilePayload {
  name: string;
  type: string;
  size: number;
  dataBase64: string;
}

export interface MiniRemoteSendRequest {
  requestId: string;
  text: string;
  files: MiniRemoteFilePayload[];
}

export type MiniRemoteSendResult =
  | { ok: true; requestId: string }
  | { ok: false; requestId: string; code: string; message?: string; droppedFiles?: string[] };

/** 快照裁剪上限（Mini 只看最近 N 轮；单条超长截断并标记） */
export const MINI_MAX_MESSAGES = 60;
export const MINI_MAX_TEXT_PER_MESSAGE = 6000;
/** 远端发送上限（与附件管线对齐：每 Turn 5 个；单文件 20MB；文本 2 万字） */
export const MINI_MAX_TEXT_CHARS = 20000;
export const MINI_MAX_FILES = 5;
export const MINI_MAX_FILE_BYTES = 20 * 1024 * 1024;

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/** `?mini=1` 判定（main.tsx 分支唯一依据；SSR safe） */
export function isMiniModeSearch(search: string): boolean {
  try {
    return new URLSearchParams(search).has("mini");
  } catch {
    return false;
  }
}

function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…（已截断）`;
}

interface SnapshotSourceMessage {
  id: string;
  role: string;
  content: string;
}

/** 主窗口运行时消息 → Mini 快照（只取尾部 N 条；非 user/assistant 一律丢弃） */
export function buildMiniSnapshot(input: {
  conversationId: string | null;
  messages: readonly SnapshotSourceMessage[];
  busy: boolean;
  streaming: boolean;
  attachments: readonly { id: string; name: string; status: string }[];
  configured: boolean;
  now?: number;
}): MiniChatSnapshot {
  const messages: MiniChatMessageView[] = [];
  for (const m of input.messages) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    if (typeof m.id !== "string" || typeof m.content !== "string") continue;
    messages.push({
      id: m.id,
      role: m.role,
      text: truncateText(m.content, MINI_MAX_TEXT_PER_MESSAGE),
    });
  }
  return {
    version: MINI_CHAT_PROTOCOL_VERSION,
    conversationId: input.conversationId,
    messages: messages.slice(-MINI_MAX_MESSAGES),
    busy: input.busy,
    streaming: input.streaming,
    attachments: input.attachments.map((a) => ({ id: a.id, name: a.name, status: a.status })),
    configured: input.configured,
    updatedAt: typeof input.now === "number" ? input.now : Date.now(),
  };
}

export interface SanitizedMiniSend {
  text: string;
  files: MiniRemoteFilePayload[];
  droppedFiles: string[];
}

/**
 * 远端发送校验（主窗口执行前最后一道门；浏览器 safe，无 Buffer）：
 * - 文本 trim；文本与文件至少其一；
 * - 文件数上限（超量按序丢弃并具名）；单文件字节上限（超量丢弃并具名）；
 * - base64 形状校验（非法 → 丢弃并具名）；size 自述与载荷明显不符（>25% 偏差）→ 丢弃。
 */
export function sanitizeMiniSend(input: {
  text: unknown;
  files: readonly MiniRemoteFilePayload[] | unknown;
}): { ok: true; value: SanitizedMiniSend } | { ok: false; code: string; message: string } {
  const text = typeof input.text === "string" ? input.text.trim() : "";
  const rawFiles = Array.isArray(input.files) ? input.files : [];
  const files: MiniRemoteFilePayload[] = [];
  const droppedFiles: string[] = [];
  for (const f of rawFiles.slice(0, MINI_MAX_FILES + 4)) {
    const name = typeof (f as MiniRemoteFilePayload)?.name === "string" ? (f as MiniRemoteFilePayload).name : "未命名文件";
    if (files.length >= MINI_MAX_FILES) {
      droppedFiles.push(name);
      continue;
    }
    const type = typeof (f as MiniRemoteFilePayload)?.type === "string" ? (f as MiniRemoteFilePayload).type : "";
    const size = typeof (f as MiniRemoteFilePayload)?.size === "number" ? (f as MiniRemoteFilePayload).size : NaN;
    const dataBase64 = typeof (f as MiniRemoteFilePayload)?.dataBase64 === "string" ? (f as MiniRemoteFilePayload).dataBase64 : "";
    if (!Number.isFinite(size) || size <= 0 || size > MINI_MAX_FILE_BYTES) {
      droppedFiles.push(name);
      continue;
    }
    const compact = dataBase64.replace(/\s+/g, "");
    if (compact.length === 0 || compact.length % 4 !== 0 || !BASE64_RE.test(compact)) {
      droppedFiles.push(name);
      continue;
    }
    // base64 载荷 ≈ 原字节 × 4/3；自述 size 与载荷偏差 >25% 视为伪造/损坏
    const decodedApprox = (compact.length * 3) / 4;
    if (Math.abs(decodedApprox - size) / Math.max(size, 1) > 0.25) {
      droppedFiles.push(name);
      continue;
    }
    files.push({ name: name.slice(0, 128), type: type.slice(0, 128), size, dataBase64: compact });
  }
  if (text.length > MINI_MAX_TEXT_CHARS) {
    return { ok: false, code: "TEXT_TOO_LONG", message: `输入过长（上限 ${MINI_MAX_TEXT_CHARS} 字）。` };
  }
  if (text.length === 0 && files.length === 0) {
    return { ok: false, code: "EMPTY", message: "请输入内容或添加附件。" };
  }
  return { ok: true, value: { text, files, droppedFiles } };
}

/** base64 → Uint8Array（浏览器 safe；atob 分段避免大字符串栈溢出） */
export function base64ToBytes(dataBase64: string): Uint8Array {
  return decodeBase64(dataBase64.replace(/\s+/g, ""));
}

function decodeBase64(dataBase64: string): Uint8Array {
  // atob 分段：每次解码一段 base64（长度须为 4 的倍数），拼接二进制
  const STEP = 4 * 4096;
  const bytes: number[] = [];
  for (let i = 0; i < dataBase64.length; i += STEP) {
    const part = atob(dataBase64.slice(i, i + STEP));
    for (let j = 0; j < part.length; j++) bytes.push(part.charCodeAt(j));
  }
  return new Uint8Array(bytes);
}

/** Uint8Array → base64（Mini 侧发送前编码；分块避免 apply 栈溢出） */
export function bytesToBase64(bytes: Uint8Array): string {
  const STEP = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += STEP) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + STEP)) as number[]);
  }
  return btoa(binary);
}
