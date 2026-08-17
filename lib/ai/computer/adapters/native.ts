/**
 * Native（ClassFlow Desktop Bridge）Adapter —— 真实本地文件夹 IO（V1）。
 *
 * 安全契约：
 * - 只由 Computer Executor 在 policy/grant 通过后调用（resolver 仍是第一安全边界）。
 * - 本模块绝不 import fs / path / electron / tauri；所有 IO 只经 getClassFlowDesktopBridge()。
 * - 每次操作都重新 resolve Bridge（不缓存）—— lifecycle 可能随 reload / runtime restart / 权限丢失变化。
 * - 每次真实 IO 前 getGrantStatus(grantId) 必须为 granted；missing/denied 映射现有
 *   ComputerError（WORKSPACE_PERMISSION_REQUIRED / PERMISSION_DENIED），绝不伪装成文件不存在。
 * - Desktop Bridge 的原始异常绝不传给模型：统一映射为 ComputerErrorCode。
 * - 只接受 grantId + relative path；adapterRef 必须是 native:<grantId>（严格解析）。
 */
import { ComputerAdapterCapabilities } from "@/lib/ai/computer/adapters/types";
import { ComputerError } from "@/lib/ai/computer/errors";
import {
  getClassFlowDesktopBridge,
  nativeGrantIdFromAdapterRef,
} from "@/lib/desktop/bridge";
import { DesktopBridgeErrorCode } from "@/lib/desktop/types";

export function nativeAdapterCapabilities(): ComputerAdapterCapabilities {
  return {
    kind: "native",
    nativeWorkspace: true,
    canRead: true,
    canWrite: true, // 实际由 root access 决定；policy 层对 read-only root hard deny
    canOpenNativeFile: false,
    canRevealNativeFile: false,
  };
}

/**
 * V1.1（0.4）：bridge.message 是「不受信任」的输入（理论上可能包含 absolute path / UNC / username /
 * OS stack / EPERM path）。Web 侧作为第二道边界：
 * - 生产 ComputerError 使用 ClassFlow 固定文案（绝不把 bridge.message 发给模型）。
 * - bridge.message 只进入 dev console，且先 sanitize（移除 drive path / UNC / file:// / stack 样式文本）。
 */

/** 识别并移除路径/堆栈样式的敏感片段（保守正则；不假设 Desktop Runtime 已脱敏） */
export function sanitizeBridgeDebugMessage(message: string): string {
  return message
    .replace(/[A-Za-z]:\\[^\s;,)\]]{1,300}/g, "[path]")
    .replace(/\\\\[^\s;,)\]]{1,200}/g, "[unc]")
    .replace(/file:\/\/\/?[^\s;,)\]]{1,300}/g, "[url]")
    .replace(/at\s+[^\n]{1,120}/g, "[stack]")
    .replace(/\s{2,}/g, " ")
    .slice(0, 200);
}

/** Bridge 结构化错误 → 现有 ComputerErrorCode（固定 ClassFlow 文案；绝不透传 Runtime 内部异常/路径/stack） */
function mapBridgeError(err: unknown, fallback: ComputerError["code"]): never {
  const e = err as { code?: unknown; message?: unknown } | null | undefined;
  const code = e?.code;
  const rawMessage = typeof e?.message === "string" ? e.message : "";
  // dev-only debug channel（sanitize 后；绝不进入模型 / Tool Result / Audit 文案）
  if (rawMessage) {
    // eslint-disable-next-line no-console
    console.debug("[kiro:native] bridge error", sanitizeBridgeDebugMessage(rawMessage));
  }
  switch (code as DesktopBridgeErrorCode | undefined) {
    case "NOT_FOUND":
      throw new ComputerError("RESOURCE_NOT_FOUND", "文件或目录不存在");
    case "ALREADY_EXISTS":
      throw new ComputerError("RESOURCE_ALREADY_EXISTS", "目标已存在");
    case "PERMISSION_DENIED":
      throw new ComputerError("PERMISSION_DENIED", "没有权限访问该位置");
    case "DIRECTORY_NOT_EMPTY":
      throw new ComputerError("VERIFICATION_FAILED", "目录非空，无法删除");
    case "INVALID_OPERATION":
      throw new ComputerError("INVALID_INPUT", "操作无效");
    case "IO_ERROR":
      throw new ComputerError(fallback, "本地文件操作失败");
    default:
      // 非结构化错误（bridge 违反 contract）→ 也走同一映射，绝不把原始异常暴露给模型
      throw new ComputerError(fallback, "本地文件操作失败");
  }
}

function bridgeUnavailable(): never {
  // runtime missing（例如桌面版创建的 workspace 在普通浏览器打开）
  throw new ComputerError("RESOURCE_NOT_FOUND", "该本地位置仅可在桌面版访问");
}

function grantIdOf(adapterRef: string): string {
  const grantId = nativeGrantIdFromAdapterRef(adapterRef);
  if (!grantId) {
    throw new ComputerError("WORKSPACE_PERMISSION_REQUIRED", "本地授权信息无效，需要重新授权");
  }
  return grantId;
}

/** 每次真实 IO 前：Bridge 存在 + grant 有效（live 检查；turn snapshot 冻结的是 intent，不是 OS 权限） */
async function requireNativeGrant(adapterRef: string): Promise<{ grantId: string; fs: NonNullable<ReturnType<typeof getClassFlowDesktopBridge>>["filesystem"] }> {
  const bridge = getClassFlowDesktopBridge();
  if (!bridge) bridgeUnavailable();
  const grantId = grantIdOf(adapterRef);
  let status: string;
  try {
    status = (await bridge.filesystem.getGrantStatus({ grantId })).status;
  } catch (err) {
    // Bridge 本身异常 → 视为权限不可用（绝不误报文件不存在）
    throw new ComputerError("WORKSPACE_PERMISSION_REQUIRED", "无法确认本地授权状态，请重新授权");
  }
  if (status === "missing" || status === "denied") {
    throw new ComputerError(
      status === "denied" ? "PERMISSION_DENIED" : "WORKSPACE_PERMISSION_REQUIRED",
      status === "denied" ? "本地授权已被拒绝" : "本地授权已失效，需要重新授权"
    );
  }
  if (status !== "granted") {
    throw new ComputerError("WORKSPACE_PERMISSION_REQUIRED", "本地授权不可用，需要重新授权");
  }
  return { grantId, fs: bridge.filesystem };
}

export async function nativeListDirectory(
  adapterRef: string,
  dirPath: string
): Promise<{ name: string; kind: "file" | "directory"; size: number; mtime?: number }[]> {
  const { grantId, fs } = await requireNativeGrant(adapterRef);
  try {
    return await fs.list({ grantId, path: dirPath });
  } catch (err) {
    mapBridgeError(err, "VERIFICATION_FAILED");
  }
}

export async function nativeStat(
  adapterRef: string,
  path: string
): Promise<{ kind: "file" | "directory"; size: number; type: string } | null> {
  const { grantId, fs } = await requireNativeGrant(adapterRef);
  try {
    const entry = await fs.stat({ grantId, path });
    if (!entry) return null;
    return { kind: entry.kind, size: entry.size, type: entry.type ?? "" };
  } catch (err) {
    mapBridgeError(err, "VERIFICATION_FAILED");
  }
}

export async function nativeReadText(adapterRef: string, path: string): Promise<string> {
  const { grantId, fs } = await requireNativeGrant(adapterRef);
  try {
    return await fs.readText({ grantId, path });
  } catch (err) {
    mapBridgeError(err, "RESOURCE_NOT_FOUND");
  }
}

export async function nativeReadBytes(adapterRef: string, path: string): Promise<Uint8Array> {
  const { grantId, fs } = await requireNativeGrant(adapterRef);
  try {
    return await fs.readBytes({ grantId, path });
  } catch (err) {
    mapBridgeError(err, "RESOURCE_NOT_FOUND");
  }
}

export async function nativeCreateDirectory(adapterRef: string, path: string): Promise<"created" | "exists"> {
  const { grantId, fs } = await requireNativeGrant(adapterRef);
  try {
    return await fs.createDirectory({ grantId, path });
  } catch (err) {
    mapBridgeError(err, "VERIFICATION_FAILED");
  }
}

export async function nativeWriteText(adapterRef: string, path: string, content: string, type?: string): Promise<void> {
  const { grantId, fs } = await requireNativeGrant(adapterRef);
  try {
    await fs.writeText({ grantId, path, content, type });
  } catch (err) {
    mapBridgeError(err, "VERIFICATION_FAILED");
  }
}

export async function nativeWriteBytes(adapterRef: string, path: string, content: Uint8Array, type?: string): Promise<void> {
  const { grantId, fs } = await requireNativeGrant(adapterRef);
  try {
    await fs.writeBytes({ grantId, path, content, type });
  } catch (err) {
    mapBridgeError(err, "VERIFICATION_FAILED");
  }
}

/** Undo 专用（非 Model Tool）：non-recursive remove（目录非空 → bridge DIRECTORY_NOT_EMPTY → undo fail） */
export async function nativeRemove(adapterRef: string, path: string, kind: "file" | "directory"): Promise<void> {
  const { grantId, fs } = await requireNativeGrant(adapterRef);
  if (!path) throw new ComputerError("VERIFICATION_FAILED", "不能删除根目录");
  try {
    await fs.remove({ grantId, path, kind });
  } catch (err) {
    mapBridgeError(err, "VERIFICATION_FAILED");
  }
}

export async function nativeMove(adapterRef: string, from: string, to: string): Promise<void> {
  const { grantId, fs } = await requireNativeGrant(adapterRef);
  try {
    await fs.move({ grantId, from, to });
  } catch (err) {
    mapBridgeError(err, "VERIFICATION_FAILED");
  }
}

export async function nativeReadTextPrefix(
  adapterRef: string,
  path: string,
  maxBytes: number
): Promise<{ text: string; truncated: boolean }> {
  const { grantId, fs } = await requireNativeGrant(adapterRef);
  try {
    return await fs.readTextPrefix({ grantId, path, maxBytes });
  } catch (err) {
    mapBridgeError(err, "RESOURCE_NOT_FOUND");
  }
}

/** Settings 显式移除：忘记授权映射（绝不删除真实目录内容）。Bridge 不存在时 no-op（web 侧没有可忘的映射） */
export async function forgetNativeGrant(adapterRef: string): Promise<void> {
  const grantId = nativeGrantIdFromAdapterRef(adapterRef);
  if (!grantId) return;
  const bridge = getClassFlowDesktopBridge();
  if (!bridge) return;
  try {
    await bridge.filesystem.forgetGrant({ grantId });
  } catch {
    // 忘记授权失败不阻塞删除流程（保持「移除 workspace」语义完成）
  }
}
