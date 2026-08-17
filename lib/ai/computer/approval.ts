/**
 * Kiro Computer Agent V1 — Approval Lifecycle（Part 3）。
 * ask 不是 error：Approval 只能满足「已 ask」的 policy 结果。
 * 绝不能覆盖 deny / hard deny / read-only root / PATH_OUTSIDE_SANDBOX / missing or revoked grant。
 * Model 不能选择 approval 持久化；Tool Schema 不暴露 permission/approval/remember/force/unsafe/skipCheck。
 */
import { ComputerCapability, ComputerPermissionRule, ComputerRisk } from "@/lib/ai/computer/types";

export type ComputerApprovalDecision = "deny" | "allow-once" | "allow-session" | "allow-workspace";

export interface ComputerApprovalRequest {
  id: string;
  toolCallId: string;
  taskId: string;
  capability: ComputerCapability;
  risk: ComputerRisk;
  workspaceId: string;
  workspaceLabel: string;
  rootId?: string;
  rootLabel?: string;
  relativePath?: string;
  resourceLabel: string;
  description: string;
  allowedDecisions: ComputerApprovalDecision[];
  /** Desktop Terminal V1：allow-once 精确绑定（shell/rootId/cwd/command fingerprint） */
  fingerprint?: string;
  /** 终端命令预览（≤500；Audit deny 路径记录用；不存完整命令/输出） */
  commandPreview?: string;
  shell?: "powershell" | "cmd";
  /** Terminal risk（normal/destructive/privileged；blocked 不会走到 approval） */
  terminalRisk?: "normal" | "destructive" | "privileged";
}

/** allow-once：exact 匹配（toolCallId + capability + workspace + root + relativePath [+ fingerprint]），一次消费 */
export interface ComputerOneShotApproval {
  approvalId: string;
  toolCallId: string;
  capability: ComputerCapability;
  workspaceId: string;
  rootId?: string;
  relativePath?: string;
  /** Desktop Terminal V1：terminal approval 必须指纹精确匹配 */
  fingerprint?: string;
}

export const COMPUTER_APPROVAL_DECISIONS: ComputerApprovalDecision[] = [
  "deny",
  "allow-once",
  "allow-session",
  "allow-workspace",
];

/** capability → risk 映射（Approval Request 展示用；V1 无 destructive 工具） */
export function riskOfCapability(capability: ComputerCapability): ComputerRisk {
  switch (capability) {
    case "workspace.list":
    case "fs.list":
    case "fs.search":
    case "fs.read":
      return "read";
    case "fs.create":
    case "document.create":
      return "create";
    case "fs.modify":
    case "document.modify":
    case "fs.move":
      return "modify";
    case "fs.delete":
      return "destructive";
    case "app.open":
    case "app.reveal":
    case "shell.execute":
      return "execute";
    case "network.access":
      return "external";
  }
}

/** 构建 Approval Request（仅 policy.effect === "ask" 时由 Executor 调用） */
export function buildApprovalRequest(input: {
  id: string;
  toolCallId: string;
  taskId: string;
  capability: ComputerCapability;
  workspaceId: string;
  workspaceLabel: string;
  rootId?: string;
  rootLabel?: string;
  relativePath?: string;
  resourceLabel: string;
  description: string;
  fingerprint?: string;
  commandPreview?: string;
  shell?: "powershell" | "cmd";
  risk?: "normal" | "destructive" | "privileged";
  allowedDecisions?: ComputerApprovalDecision[];
}): ComputerApprovalRequest {
  return {
    id: input.id,
    toolCallId: input.toolCallId,
    taskId: input.taskId,
    capability: input.capability,
    risk: riskOfCapability(input.capability),
    workspaceId: input.workspaceId,
    workspaceLabel: input.workspaceLabel,
    rootId: input.rootId,
    rootLabel: input.rootLabel,
    relativePath: input.relativePath,
    resourceLabel: input.resourceLabel,
    description: input.description,
    allowedDecisions: input.allowedDecisions ?? COMPUTER_APPROVAL_DECISIONS,
    ...(input.fingerprint !== undefined ? { fingerprint: input.fingerprint } : {}),
    ...(input.commandPreview !== undefined ? { commandPreview: input.commandPreview } : {}),
    ...(input.shell !== undefined ? { shell: input.shell } : {}),
    ...(input.risk !== undefined ? { terminalRisk: input.risk } : {}),
  };
}

/** allow-once exact match（同 toolCall/capability/workspace/root/path 才匹配；terminal 额外指纹精确匹配） */
export function oneShotApprovalMatches(
  oneShot: ComputerOneShotApproval,
  request: Pick<
    ComputerApprovalRequest,
    "toolCallId" | "capability" | "workspaceId" | "rootId" | "relativePath" | "fingerprint"
  >
): boolean {
  if (oneShot.toolCallId !== request.toolCallId) return false;
  if (oneShot.capability !== request.capability) return false;
  if (oneShot.workspaceId !== request.workspaceId) return false;
  if ((oneShot.rootId ?? undefined) !== (request.rootId ?? undefined)) return false;
  if ((oneShot.relativePath ?? undefined) !== (request.relativePath ?? undefined)) return false;
  // Desktop Terminal V1：任何一侧有 fingerprint → 必须精确匹配（allow-once 不能批准其它命令）
  if (oneShot.fingerprint !== undefined || request.fingerprint !== undefined) {
    if (oneShot.fingerprint !== request.fingerprint) return false;
  }
  return true;
}

/** allow-session：exact-resource 规则，scope=session（只存在内存；persist partialize 过滤） */
export function sessionRuleForRequest(
  request: Pick<ComputerApprovalRequest, "capability" | "workspaceId" | "rootId" | "relativePath">
): ComputerPermissionRule {
  return {
    id: `session-${crypto.randomUUID()}`,
    effect: "allow",
    capability: request.capability,
    workspaceId: request.workspaceId,
    rootId: request.rootId,
    resourcePattern: request.relativePath,
    scope: "session",
  };
}

/** allow-workspace：capability + workspace，scope=persistent；不写 resourcePattern */
export function workspaceRuleForRequest(
  request: Pick<ComputerApprovalRequest, "capability" | "workspaceId">
): ComputerPermissionRule {
  return {
    id: `persistent-${crypto.randomUUID()}`,
    effect: "allow",
    capability: request.capability,
    workspaceId: request.workspaceId,
    scope: "persistent",
  };
}
