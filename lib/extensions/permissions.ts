/**
 * Permission Model V2 — Task 06
 * 核心不变量：Effective Permission = Origin Policy ∩ Agent Mode ∩ Extension Grant ∩ Tool Risk Policy, deny always wins.
 * 远端 (remote-channel) 永远受限，Skill/MCP 不能成为提权器。
 */

import type { KiroAgentMode } from "@/lib/ai/computer/types";

export type Permission =
  | "read"
  | "propose"
  | "write"
  | "delete"
  | "external-side-effect"
  | "terminal"
  | "filesystem"
  | "filesystem-write";

export type InvocationOrigin = "local-user" | "remote-channel";

/** @deprecated 旧模型混淆 origin 与 actor，已拆分为 InvocationOrigin + CapabilityActor */
export type PermissionOrigin = InvocationOrigin | "skill" | "mcp";

export type CapabilityActor =
  | { kind: "native" }
  | { kind: "skill"; skillId: string }
  | { kind: "mcp"; connectionId: string; toolName?: string };

export type AgentMode = KiroAgentMode; // "plan" | "guided" | "workspace-auto"

const REMOTE_DENIED: ReadonlySet<Permission> = new Set<Permission>([
  "terminal",
  "filesystem",
  "filesystem-write",
  "delete",
  "write",
  "external-side-effect",
]);

export interface PermissionRequest {
  origin: InvocationOrigin | PermissionOrigin;
  permission: Permission;
  agentMode?: AgentMode;
  actor?: CapabilityActor;
  actorGranted?: boolean;
}

export interface PermissionResolution {
  allowed: boolean;
  reason: string;
}

/**
 * 分层校验：
 * 1. Origin Policy（remote 最严格）
 * 2. Extension Grant（skill/mcp 需授权）
 * 3. Agent Mode（plan 最严格，guided 中等，workspace-auto 最宽）
 * 4. deny always wins
 */
export function resolvePermission(req: PermissionRequest): PermissionResolution {
  // 兼容旧 PermissionOrigin 的 skill/mcp：将它们映射为 local-user + 对应 actor
  let origin: InvocationOrigin | string = req.origin as string;
  let actor: CapabilityActor | undefined = req.actor;
  const permission = req.permission;
  const agentMode = req.agentMode;
  const actorGranted = (req as PermissionRequest).actorGranted;

  if (origin === "skill" || origin === "mcp") {
    if (!actor) {
      actor = origin === "skill" ? { kind: "skill", skillId: "legacy-skill" } : { kind: "mcp", connectionId: "legacy-mcp" };
    }
    origin = "local-user";
  }

  // Layer 1: Origin Policy
  if (origin === "remote-channel") {
    if (REMOTE_DENIED.has(permission)) {
      return { allowed: false, reason: `remote-channel denied: ${permission}` };
    }
    if (permission !== "read" && permission !== "propose") {
      return { allowed: false, reason: `remote-channel denied: ${permission} (not in allowlist)` };
    }
    // Origin allows read/propose, but still subject to Extension Grant and Agent Mode (deny wins)
    // Fall through to next layers; if they deny, result is deny.
  } else if (origin !== "local-user") {
    return { allowed: false, reason: `unknown origin: ${origin}` };
  }

  // Layer 2: Extension Grant — 仅当 actor 为 skill/mcp 且显式 actorGranted===false 时拒绝
  if (actor && (actor.kind === "skill" || actor.kind === "mcp")) {
    if (actorGranted === false) {
      return { allowed: false, reason: `${actor.kind} grant denied: ${permission}` };
    }
  }

  // Layer 3: Agent Mode Policy（仅当显式提供 agentMode 时才限制；兼容旧 local-user 无 mode 时全部允许）
  if (agentMode) {
    if (agentMode !== "plan" && agentMode !== "guided" && agentMode !== "workspace-auto") {
      return { allowed: false, reason: `unknown agentMode: ${agentMode}` };
    }
    if (agentMode === "plan") {
      // plan：仅允许 read / propose
      if (permission !== "read" && permission !== "propose") {
        return { allowed: false, reason: `plan denied: ${permission}` };
      }
    } else if (agentMode === "guided") {
      // guided：拒绝高危 terminal / filesystem-write（plan 已拒绝更多）
      if (permission === "terminal" || permission === "filesystem-write") {
        return { allowed: false, reason: `guided denied: ${permission}` };
      }
      // guided 对 terminal/filesystem-write 之外允许，后续 workspace-auto 全部允许
    } else if (agentMode === "workspace-auto") {
      // 最宽松：不额外拒绝，依赖 Origin 和 Grant 已校验
    }
  }

  // 全部层通过 → allow
  if (origin === "remote-channel") {
    return { allowed: true, reason: `remote-channel allowed: ${permission}` };
  }
  if (actor) {
    return { allowed: true, reason: `${actor.kind} allowed: ${permission}` };
  }
  return { allowed: true, reason: `${origin} allowed: ${permission}` };
}

/** 批量检查 — 兼容旧签名 (origin, permissions, agentMode string) 与新签名 (origin, permissions, {agentMode, actor, actorGranted}) */
export function resolvePermissions(
  origin: InvocationOrigin | PermissionOrigin,
  permissions: Permission[],
  agentModeOrOpts?: AgentMode | string | { agentMode?: AgentMode; actor?: CapabilityActor; actorGranted?: boolean }
): Record<Permission, boolean> {
  const result = {} as Record<Permission, boolean>;
  let opts: { agentMode?: AgentMode; actor?: CapabilityActor; actorGranted?: boolean } = {};
  if (typeof agentModeOrOpts === "string") {
    opts = { agentMode: agentModeOrOpts as AgentMode };
  } else if (typeof agentModeOrOpts === "object" && agentModeOrOpts !== null) {
    opts = agentModeOrOpts as typeof opts;
  }
  for (const p of permissions) {
    result[p] = resolvePermission({ origin, permission: p, agentMode: opts.agentMode, actor: opts.actor, actorGranted: opts.actorGranted }).allowed;
  }
  return result;
}

/** Remote Origin Policy 文本（deterministic policy，非 system prompt） */
export const REMOTE_ORIGIN_POLICY = {
  origin: "remote-channel" as const,
  sources: ["qq-bot", "gmail", "qq-mail"] as const,
  allowed: ["read ClassFlow facts", "ask Kiro", "generate proposal"] as const,
  denied: [
    "direct terminal",
    "direct filesystem",
    "silent delete",
    "silent write requiring confirmation",
  ] as const,
  note: "后续远程 Proposal 需用户在桌面端确认后，由本地可信 UI 完成授权。",
};

/** 校验：确保 future 新增 Permission 不会意外绕过 remote 限制 */
export function isRemoteAllowed(permission: Permission): boolean {
  return resolvePermission({ origin: "remote-channel", permission }).allowed;
}
