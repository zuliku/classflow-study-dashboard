import {
  ComputerCapability,
  ComputerPermissionEffect,
  KiroAgentMode,
} from "@/lib/ai/computer/types";

/**
 * Agent Mode 默认权限表（V1 usable modes：plan / guided / workspace-auto）。
 * Full Access 不是 Web V1 usable mode。
 *
 * V2.7：Workspace Auto = 对当前已授权、read-write Workspace 内的文件操作充分自动授权
 * （读取/搜索/创建/修改/移动/重命名/删除/文档创建/文档更新全部 allow）；
 * 但绝不突破 Workspace sandbox / root scope / read-only root / Browser grant /
 * PATH_OUTSIDE_SANDBOX 与系统级能力（app/shell/network 恒 deny）。
 * 显式 deny 规则与 read-only root 仍优先于 mode default（policy pipeline 保证）。
 */
export const AGENT_MODE_DEFAULTS: Record<
  KiroAgentMode,
  Record<ComputerCapability, ComputerPermissionEffect>
> = {
  plan: {
    "workspace.list": "allow",
    "fs.list": "allow",
    "fs.search": "allow",
    "fs.read": "allow",
    "fs.create": "deny",
    "fs.modify": "deny",
    "fs.move": "deny",
    "fs.delete": "deny",
    "document.create": "deny",
    "document.modify": "deny",
    "app.open": "deny",
    "app.reveal": "deny",
    "shell.execute": "deny",
    "network.access": "deny",
  },
  guided: {
    "workspace.list": "allow",
    "fs.list": "allow",
    "fs.search": "allow",
    "fs.read": "allow",
    "fs.create": "allow",
    "fs.modify": "ask",
    "fs.move": "ask",
    "fs.delete": "ask",
    "document.create": "allow",
    "document.modify": "ask",
    // Desktop Terminal V1：Guided 下任何 shell 命令都请求确认（Risk Gate 再收紧）
    "shell.execute": "ask",
    "app.open": "deny",
    "app.reveal": "deny",
    "network.access": "deny",
  },
  "workspace-auto": {
    "workspace.list": "allow",
    "fs.list": "allow",
    "fs.search": "allow",
    "fs.read": "allow",
    "fs.create": "allow",
    "fs.modify": "allow",
    "fs.move": "allow",
    // Desktop Terminal V1（0.3/Part 10）：删除类操作即使在 Workspace Auto 也必须 ask——
    // 结构化 delete_file 与终端删除类命令一律需要用户确认
    "fs.delete": "ask",
    "document.create": "allow",
    "document.modify": "allow",
    // Desktop Terminal V1：普通 shell 命令在 Workspace Auto 可自动执行
    //（Terminal Risk Gate 优先：destructive/privileged → ask；blocked → deny）
    "shell.execute": "allow",
    "app.open": "deny",
    "app.reveal": "deny",
    "network.access": "deny",
  },
};

/**
 * V1 Hard Deny：无论 Agent Mode / 规则如何都拒绝。
 * Desktop Terminal V1：shell.execute 从 Hard Deny 移除——这是对「直接 ClassFlow Tool」的
 * hard deny 语义解除（run_terminal_command 是受 Policy/Risk Gate/Approval 控制的工具）。
 * 注意：Shell 命令本身理论上可以间接访问网络 / 进程 / 系统其它位置，
 * 因此不再声称「network absolutely impossible」这种不真实的保证——
 * 剩余 hard deny：app.open / app.reveal / network.access。
 * Workspace Auto 的“授权范围”是 Workspace 内 Full Access，不是系统 Full Access。
 */
export const HARD_DENY_CAPABILITIES: ReadonlySet<ComputerCapability> = new Set<ComputerCapability>([
  "app.open",
  "app.reveal",
  "network.access",
]);

/** V1 允许模型使用的 capability（Part 1 不暴露任何 Computer File Tools 给模型，但 policy 引擎预置全部）。 */
export const MUTATION_CAPABILITIES: ReadonlySet<ComputerCapability> = new Set<ComputerCapability>([
  "fs.create",
  "fs.modify",
  "fs.move",
  "fs.delete",
  "document.create",
  "document.modify",
]);
