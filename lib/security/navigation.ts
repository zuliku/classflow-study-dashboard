/**
 * Navigation / External URL hardening — Task 02
 * 只允许 http/https 走 shell.openExternal；拒绝 file/javascript/data/vbscript/custom protocol；malformed fail closed。
 * 内部允许：app:// / 当前 Vite dev origin / 127.0.0.1 本地 API origin（绑定到本次启动实际端口）。
 */

import { isTrustedRendererUrl } from "./rendererOrigin";

export type NavigationVerdict =
  | { kind: "allow-internal" }
  | { kind: "allow-external" }
  | { kind: "deny"; reason: string };

const ALLOWED_EXTERNAL_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);
const DENIED_PROTOCOLS: ReadonlySet<string> = new Set(["file:", "javascript:", "data:", "vbscript:"]);

export interface NavigationContext {
  url: string;
  allowedApiOrigin?: string; // e.g. http://127.0.0.1:5321
  allowedDevOrigin?: string; // e.g. http://localhost:5173
}

export function validateExternalUrl(rawUrl: string): { ok: boolean; reason?: string } {
  if (!rawUrl || typeof rawUrl !== "string") return { ok: false, reason: "empty url" };
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "malformed url" };
  }
  const proto = parsed.protocol.toLowerCase();
  if (DENIED_PROTOCOLS.has(proto)) return { ok: false, reason: `denied protocol: ${proto}` };
  if (!ALLOWED_EXTERNAL_PROTOCOLS.has(proto)) return { ok: false, reason: `disallowed protocol: ${proto}` };
  // 额外拒绝 javascript: 的大小写/空格变体已由 URL 解析归一
  return { ok: true };
}

export function decideNavigation(ctx: NavigationContext): NavigationVerdict {
  const raw = ctx.url;
  if (!raw || typeof raw !== "string") return { kind: "deny", reason: "empty url" };
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { kind: "deny", reason: "malformed url" };
  }
  const proto = parsed.protocol.toLowerCase();

  // 优先拒绝危险协议（fail closed）
  if (DENIED_PROTOCOLS.has(proto)) {
    return { kind: "deny", reason: `blocked protocol: ${proto}` };
  }

  // 内部允许：仅精确的 app://bundle 或精确的 dev origin
  // 使用共享 canonical 校验，避免 startsWith 误判
  if (isTrustedRendererUrl(raw, { allowedDevOrigin: ctx.allowedDevOrigin })) {
    return { kind: "allow-internal" };
  }

  // Local API origin 不作为普通页面导航的 allow-internal
  // 若为 local API 的精确 origin，视为 deny（非用户可见页面，不应 shell.openExternal）
  if (ctx.allowedApiOrigin) {
    try {
      const apiOrigin = new URL(ctx.allowedApiOrigin).origin;
      const rawOrigin = new URL(raw).origin;
      if (rawOrigin === apiOrigin) {
        return { kind: "deny", reason: "local-api-navigation" };
      }
    } catch {}
  }

  // 外部允许：仅 http/https
  if (ALLOWED_EXTERNAL_PROTOCOLS.has(proto)) {
    return { kind: "allow-external" };
  }

  return { kind: "deny", reason: `disallowed protocol: ${proto}` };
}

/** 是否应走 shell.openExternal（仅 allow-external） */
export function shouldOpenExternal(ctx: NavigationContext): boolean {
  return decideNavigation(ctx).kind === "allow-external";
}
