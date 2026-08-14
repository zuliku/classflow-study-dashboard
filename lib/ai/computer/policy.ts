import {
  ComputerCapability,
  ComputerPermissionEffect,
  ComputerPermissionRule,
  KiroAgentMode,
} from "@/lib/ai/computer/types";
import {
  AGENT_MODE_DEFAULTS,
  HARD_DENY_CAPABILITIES,
  MUTATION_CAPABILITIES,
} from "@/lib/ai/computer/capabilities";

export interface PolicyContext {
  capability: ComputerCapability;
  mode: KiroAgentMode;
  rules: ComputerPermissionRule[];
  workspaceId?: string;
  rootId?: string;
  rootAccess?: "read-only" | "read-write";
  /** 规范化相对路径（不含 root） */
  resourcePath?: string;
}

export interface PolicyDecision {
  effect: ComputerPermissionEffect;
  reason: string;
  /** 由哪个 rule 触发（调试/审计） */
  matchedRuleId?: string;
}

/** `prefix/**` 与 exact path 匹配（Part 1 不引入 glob dependency） */
function matchesResourcePattern(pattern: string, resourcePath: string): boolean {
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return resourcePath === prefix || resourcePath.startsWith(prefix + "/");
  }
  return pattern === resourcePath;
}

function ruleMatches(rule: ComputerPermissionRule, context: PolicyContext): boolean {
  if (rule.workspaceId && rule.workspaceId !== context.workspaceId) return false;
  if (rule.rootId && rule.rootId !== context.rootId) return false;
  if (rule.resourcePattern && context.resourcePath !== undefined) {
    if (!matchesResourcePattern(rule.resourcePattern, context.resourcePath)) return false;
  }
  return true;
}

function ruleSpecificity(rule: ComputerPermissionRule): number {
  let s = 0;
  if (rule.resourcePattern) s += 3;
  if (rule.rootId) s += 2;
  if (rule.workspaceId) s += 1;
  return s;
}

const HARD_DENY_LABELS: Record<ComputerCapability, string> = {
  "fs.delete": "删除文件",
  "app.open": "打开应用",
  "app.reveal": "显示位置",
  "shell.execute": "执行命令",
  "network.access": "网络访问",
  "workspace.list": "workspace.list",
  "fs.list": "fs.list",
  "fs.search": "fs.search",
  "fs.read": "fs.read",
  "fs.create": "fs.create",
  "fs.modify": "fs.modify",
  "fs.move": "fs.move",
  "document.create": "document.create",
  "document.modify": "document.modify",
};

function modeLabel(mode: KiroAgentMode): string {
  return mode === "plan" ? "计划" : mode === "guided" ? "受控" : "工作区自动";
}

/**
 * Policy 求值（Spec §17 优先级）：
 * 1. Hard deny（app.open / app.reveal / shell.execute / network.access）
 * 2. read-only root 的 mutation hard deny（任何模式不能覆盖）
 * 3. fs.delete always-ask invariant：explicit allow rule 也不能让删除静默执行
 * 4. matching explicit deny（resource/root/workspace 特异性，最 specific 优先）
 * 5. most-specific matching explicit allow/ask
 * 6. agent-mode default
 *
 * 权限审批永远不能覆盖 sandbox 边界 / read-only root（PATH_OUTSIDE_SANDBOX 由 resolver 单独保证）。
 */
export function evaluateComputerPolicy(context: PolicyContext): PolicyDecision {
  const { capability, mode } = context;

  // 1. Hard deny
  if (HARD_DENY_CAPABILITIES.has(capability)) {
    return { effect: "deny", reason: `V1 硬性禁用：${HARD_DENY_LABELS[capability]}` };
  }

  // 2. read-only root mutation hard deny
  if (context.rootAccess === "read-only" && MUTATION_CAPABILITIES.has(capability)) {
    return {
      effect: "deny",
      reason: `只读工作区根（${context.rootId ?? "?"}）不允许修改`,
    };
  }

  // 3+4. Explicit rules（deny 最高优先；allow/ask 取最 specific）
  const matching = context.rules.filter((r) => ruleMatches(r, context));
  if (matching.length > 0) {
    const deny = matching.find((r) => r.effect === "deny");
    if (deny) {
      return { effect: "deny", reason: `权限规则拒绝（${deny.id}）`, matchedRuleId: deny.id };
    }
    // fs.delete always-ask：即使存在 explicit allow rule，删除也必须是用户确认的 ask
    if (capability === "fs.delete") {
      return { effect: "ask", reason: "删除属于破坏性操作，每个真实删除都必须用户批准" };
    }
    const allowOrAsk = matching
      .filter((r) => r.effect !== "deny")
      .sort((a, b) => ruleSpecificity(b) - ruleSpecificity(a))[0];
    if (allowOrAsk) {
      return {
        effect: allowOrAsk.effect,
        reason: `权限规则（${allowOrAsk.id}）`,
        matchedRuleId: allowOrAsk.id,
      };
    }
  }

  // 5. fs.delete：模式默认 deny（Plan）优先；否则 always-ask invariant（Guided / Workspace Auto 都必须批准）
  if (capability === "fs.delete") {
    const modeDefault = AGENT_MODE_DEFAULTS[mode][capability];
    if (modeDefault === "deny") {
      return { effect: "deny", reason: `${modeLabel(mode)} 默认权限` };
    }
    return { effect: "ask", reason: "删除属于破坏性操作，每个真实删除都必须用户批准" };
  }

  // 6. Mode default
  const effect = AGENT_MODE_DEFAULTS[mode][capability];
  return { effect, reason: `${modeLabel(mode)} 默认权限` };
}
