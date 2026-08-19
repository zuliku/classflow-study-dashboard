/**
 * Permission 基础模型 — Task 04
 * 统一权限语义，供 Skill / MCP / Channel 共用；核心安全规则：remote-channel 永不获得 terminal/filesystem 直接写入等高危能力。
 */

export type Permission =
  | "read"
  | "propose"
  | "write"
  | "delete"
  | "external-side-effect"
  | "terminal"
  | "filesystem"
  | "filesystem-write";

export type PermissionOrigin =
  | "local-user"
  | "skill"
  | "mcp"
  | "remote-channel";

export type AgentMode = "plan" | "ask" | "workspace-auto";

/**
 * Deterministic permission resolution.
 * 输入：origin + 当前 agentMode + 请求权限
 * 输出：是否允许
 *
 * 安全不变量（必须测试）：
 * - remote-channel 无论任何 agentMode，都不能获得 terminal / filesystem / filesystem-write / silent destructive write
 * - remote-channel 只能 read / propose（+ 受限的 external-side-effect? 本任务禁止）
 * - workspace-auto 不能覆盖 remote restriction
 */

const REMOTE_DENIED: ReadonlySet<Permission> = new Set<Permission>([
  "terminal",
  "filesystem",
  "filesystem-write",
  "delete",
  // write 仅允许通过 proposal（propose），不允许直接 silent write
  "write",
  "external-side-effect",
]);

export interface PermissionRequest {
  origin: PermissionOrigin;
  permission: Permission;
  agentMode?: AgentMode;
}

export interface PermissionResolution {
  allowed: boolean;
  reason: string;
}

/**
 * 核心策略：pure function，无 I/O，无随机性。
 */
export function resolvePermission(req: PermissionRequest): PermissionResolution {
  const { origin, permission } = req;

  // remote-channel 严格受限：即使 workspace-auto 也不提升
  if (origin === "remote-channel") {
    if (REMOTE_DENIED.has(permission)) {
      return { allowed: false, reason: `remote-channel denied: ${permission}` };
    }
    // 仅允许 read / propose
    if (permission === "read" || permission === "propose") {
      return { allowed: true, reason: `remote-channel allowed: ${permission}` };
    }
    // 其他未明确允许的也拒绝（fail closed）
    return { allowed: false, reason: `remote-channel denied: ${permission} (not in allowlist)` };
  }

  // local-user：完全信任（UI 已授权）
  if (origin === "local-user") {
    return { allowed: true, reason: `local-user allowed: ${permission}` };
  }

  // skill / mcp：目前与 local-user 同权，但保留未来按 skill/mcp 细粒度控制的扩展点
  // 本任务不实现 MCP 网络连接，仅定义类型；此处允许全部，后续再收敛
  if (origin === "skill" || origin === "mcp") {
    // 甚至 skill/mcp 的 terminal/filesystem 仍需用户在 Agent Mode 中授权；
    // 本基础模型先允许，未来接入 Tool Router 时再按 agentMode 细化
    return { allowed: true, reason: `${origin} allowed: ${permission}` };
  }

  return { allowed: false, reason: `unknown origin: ${origin}` };
}

/** 批量检查 */
export function resolvePermissions(
  origin: PermissionOrigin,
  permissions: Permission[],
  agentMode?: AgentMode
): Record<Permission, boolean> {
  const result = {} as Record<Permission, boolean>;
  for (const p of permissions) {
    result[p] = resolvePermission({ origin, permission: p, agentMode }).allowed;
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
