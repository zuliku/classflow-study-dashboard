/**
 * ClassFlow Desktop Bridge —— Runtime Detection + Grant 校验（Web 侧唯一访问入口）。
 *
 * SSR safe：所有 window 访问都经过 typeof window 守卫，绝不直接在 module scope 触碰
 * window.classflowDesktop（全 repo 只允许本模块访问该 global）。
 *
 * 安全规则：
 * - 只接受 version === 1 的完整 Bridge；非法 / 不完整 / 未知版本一律视为 unavailable。
 * - grantId 校验（1–128 chars，仅 [A-Za-z0-9_-]；拒绝 slash/backslash/colon/路径样式 token）。
 * - adapterRef namespace：native:<grantId>；解析严格，绝不把 grantId 裸存。
 */
import {
  CLASSFLOW_DESKTOP_BRIDGE_VERSION,
  ClassFlowDesktopBridgeV1,
} from "@/lib/desktop/types";

export const NATIVE_ADAPTER_REF_PREFIX = "native:";
const GRANT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** Desktop Runtime 是否可用（SSR safe；version 协商） */
export function isClassFlowDesktopRuntime(): boolean {
  return getClassFlowDesktopBridge() !== null;
}

/** 获取当前 Bridge（每次调用重新读取；绝不缓存 —— lifecycle 可能随 reload / restart / 权限丢失变化） */
export function getClassFlowDesktopBridge(): ClassFlowDesktopBridgeV1 | null {
  if (typeof window === "undefined") return null;
  const bridge = window.classflowDesktop;
  if (!bridge || typeof bridge !== "object") return null;
  if (bridge.version !== CLASSFLOW_DESKTOP_BRIDGE_VERSION) return null; // 未知版本：不做猜测兼容
  const fs = bridge.filesystem;
  if (!fs || typeof fs !== "object") return null;
  // 核心表面方法缺失 → 视为不完整 Bridge（不可用；readBytes 必须在列——0.1 修复）
  const required = ["pickDirectory", "getGrantStatus", "forgetGrant", "list", "stat", "readText", "readBytes", "readTextPrefix", "createDirectory", "writeText", "writeBytes", "remove", "move"] as const;
  if (!required.every((m) => typeof (fs as unknown as Record<string, unknown>)[m] === "function")) return null;
  return bridge;
}

/**
 * Terminal Bridge（V1，optional capability）：
 * Desktop Runtime 可以只有 filesystem（Native Folder V1 保持 valid）——
 * terminal 缺失绝不使整个 Bridge invalid。
 */
export function getClassFlowDesktopTerminalBridge(): import("@/lib/desktop/types").ClassFlowDesktopTerminalBridgeV1 | null {
  const bridge = getClassFlowDesktopBridge();
  if (!bridge) return null;
  const terminal = bridge.terminal;
  if (!terminal || typeof terminal !== "object") return null;
  if (terminal.version !== 1) return null;
  if (typeof terminal.execute !== "function" || typeof terminal.cancel !== "function") return null;
  return terminal;
}

/** Terminal Bridge 是否可用（SSR safe） */
export function hasClassFlowDesktopTerminal(): boolean {
  return getClassFlowDesktopTerminalBridge() !== null;
}

/**
 * grantId 校验：opaque token。
 * 拒绝：空 / 超长 / 非 [A-Za-z0-9_-] / 路径样式（slash、backslash、colon 均被字符集排除；
 * "." 与 ".." 被显式排除；native: 前缀被显式排除）。
 */
export function isValidNativeGrantId(grantId: unknown): grantId is string {
  if (typeof grantId !== "string") return false;
  if (!GRANT_ID_PATTERN.test(grantId)) return false;
  if (grantId === "." || grantId === "..") return false;
  if (grantId.startsWith(NATIVE_ADAPTER_REF_PREFIX)) return false;
  return true;
}

/** adapterRef 是否为 Native（显式 namespace：native:<grantId>） */
export function isNativeAdapterRef(adapterRef: string): boolean {
  return typeof adapterRef === "string" && adapterRef.startsWith(NATIVE_ADAPTER_REF_PREFIX);
}

/** 从 adapterRef 严格解析 grantId（非法 / 非 native → null；绝不宽松解析） */
export function nativeGrantIdFromAdapterRef(adapterRef: string): string | null {
  if (!isNativeAdapterRef(adapterRef)) return null;
  const grantId = adapterRef.slice(NATIVE_ADAPTER_REF_PREFIX.length);
  return isValidNativeGrantId(grantId) ? grantId : null;
}
