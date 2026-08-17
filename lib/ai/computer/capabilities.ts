import {
  ComputerCapability,
  ComputerPermissionEffect,
  KiroAgentMode,
} from "@/lib/ai/computer/types";

/**
 * Agent Mode 默认权限表（Current behavior；plan / guided / workspace-auto）。
 * Full Access 不是 usable mode。
 *
 * Current behavior（Desktop Terminal V1.0.1 冻结）：
 * - Plan：read-only（read/search/list allow）；所有 mutation + shell deny。
 * - Guided：create（fs/document）allow；modify / move / delete ask；shell ask。
 * - Workspace Auto：read / create / modify / move / document allow；**fs.delete = ask**
 *   （删除操作即使在 Workspace Auto 也要求确认）；shell.execute = allow（普通命令自动执行），
 *   但 Terminal Risk Gate 会把 destructive / privileged 升级为 ask、blocked 直接 deny。
 * - Hard Deny（任何 mode / 规则不能覆盖）：app.open / app.reveal / network.access。
 * - shell.execute **不再是** hard deny：受 Desktop runtime / 用户 terminalEnabled 偏好 /
 *   workspace native root / policy / Terminal Risk Gate / approval 全链控制。
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
    // Current behavior：删除类操作即使在 Workspace Auto 也必须 ask——
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
 * Hard Deny（Current behavior）：无论 Agent Mode / 规则如何都拒绝。
 * shell.execute 不在其中（受 Desktop runtime / terminalEnabled / native root / policy /
 * Risk Gate / approval 全链控制）；但 Shell 本身理论上可以间接访问网络 / 进程 / 系统其它位置，
 * 因此不声称「network absolutely impossible」。剩余 hard deny：app.open / app.reveal / network.access。
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
