import {
  ComputerCapability,
  ComputerPermissionEffect,
  KiroAgentMode,
} from "@/lib/ai/computer/types";

/**
 * Agent Mode 默认权限表（V1 usable modes：plan / guided / workspace-auto）。
 * Full Access 不是 Web V1 usable mode。
 * 每个 capability 的 effect 与 Spec §16 完全一致。
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
    "fs.delete": "deny",
    "document.create": "allow",
    "document.modify": "ask",
    "app.open": "deny",
    "app.reveal": "deny",
    "shell.execute": "deny",
    "network.access": "deny",
  },
  "workspace-auto": {
    "workspace.list": "allow",
    "fs.list": "allow",
    "fs.search": "allow",
    "fs.read": "allow",
    "fs.create": "allow",
    "fs.modify": "allow",
    "fs.move": "ask",
    "fs.delete": "deny",
    "document.create": "allow",
    "document.modify": "allow",
    "app.open": "deny",
    "app.reveal": "deny",
    "shell.execute": "deny",
    "network.access": "deny",
  },
};

/** V1 Hard Deny：无论 Agent Mode / 规则如何都拒绝（未来桌面版单独设计后解除）。 */
export const HARD_DENY_CAPABILITIES: ReadonlySet<ComputerCapability> = new Set<ComputerCapability>([
  "fs.delete",
  "app.open",
  "app.reveal",
  "shell.execute",
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
