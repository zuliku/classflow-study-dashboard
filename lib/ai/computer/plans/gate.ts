/**
 * plan-approve 偏离门 — deviation 审批请求构造（纯函数，可单测）。
 * 超计划 mutation 已在执行前被拦截（零 IO），本函数只把“拦截事实”包装成
 * Approval Request：allowedDecisions 恒为 deny/allow-once（超计划只允许单次放行，
 * 绝不授予 session/workspace 级永久权限）。
 */
import { buildApprovalRequest, type ComputerApprovalRequest } from "@/lib/ai/computer/approval";
import type { PlanCallFacts } from "@/lib/ai/computer/plans/match";
import type { PersistedExecutionPlan } from "@/lib/ai/computer/plans/types";

export function buildDeviationApprovalRequest(input: {
  plan: PersistedExecutionPlan;
  facts: PlanCallFacts;
  toolName: string;
  toolCallId: string;
  taskId: string;
  workspaceId: string;
  workspaceLabel: string;
  rootLabel?: string;
}): ComputerApprovalRequest {
  const { plan, facts, toolName, toolCallId, taskId } = input;
  return buildApprovalRequest({
    id: `approval-${crypto.randomUUID()}`,
    toolCallId,
    taskId,
    capability: facts.capability,
    workspaceId: input.workspaceId,
    workspaceLabel: input.workspaceLabel,
    ...(facts.rootId ? { rootId: facts.rootId } : {}),
    ...(input.rootLabel ? { rootLabel: input.rootLabel } : {}),
    ...(facts.paths[0] ? { relativePath: facts.paths[0] } : {}),
    resourceLabel: facts.command ?? facts.paths[0] ?? toolName,
    description: `超出已批准计划「${plan.title}」：${toolName}${facts.paths[0] ? `（${facts.paths[0]}）` : ""}不在计划步骤内。放行仅执行这一次，计划将记一次偏离。`,
    allowedDecisions: ["deny", "allow-once"],
  });
}
