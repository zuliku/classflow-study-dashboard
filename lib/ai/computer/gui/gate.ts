/**
 * Computer Use Phase 2+3 — 共享 Bridge 错误映射 + Capability 审批门（纯逻辑）。
 */
import type { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import type { ComputerCapability, ComputerPermissionRule } from "@/lib/ai/computer/types";
import { evaluateComputerPolicy } from "@/lib/ai/computer/policy";
import {
  buildApprovalRequest,
  oneShotApprovalMatches,
  type ComputerOneShotApproval,
} from "@/lib/ai/computer/approval";
import type { ComputerExecutionAttempt } from "@/lib/ai/computer/result";

export function denied(message: string, code = "PERMISSION_DENIED"): ComputerExecutionAttempt {
  return { kind: "completed", output: { ok: false, code, message } };
}

export function cancelled(): ComputerExecutionAttempt {
  return {
    kind: "completed",
    output: { ok: false, code: "CANCELLED", message: "用户已停止电脑操作。" },
  };
}

/** Bridge error → model-safe Tool Output（保留结构化 code；绝不透传 raw error） */
export function bridgeFailureOutput(
  err: unknown,
  fallbackMessage = "电脑操作失败。"
): ComputerExecutionAttempt {
  const failure = (err ?? {}) as { code?: unknown; message?: unknown };
  const code = typeof failure.code === "string" ? failure.code : "ACTION_FAILED";
  const message =
    code === "STALE_OBSERVATION"
      ? "界面已变化，请重新 observe_desktop 后再操作。"
      : typeof failure.message === "string" && failure.message
        ? failure.message
        : fallbackMessage;
  return { kind: "completed", output: { ok: false, code, message } };
}

export interface GateCapabilityRequest {
  capability: ComputerCapability;
  toolCallId: string;
  snapshot: KiroComputerTurnSnapshot;
  livePermissionRules: ComputerPermissionRule[];
  oneShotApprovals: ComputerOneShotApproval[];
  taskId: string;
  description: string;
  resourceLabel: string;
  workspaceLabel: string;
  /** one-shot 精确绑定扩展（GUI action 等） */
  fingerprint?: string;
}

/**
 * 单个 capability 的 policy 求值 + approval 生命周期。
 * @returns null = 可继续执行；否则返回终结 attempt（deny / approval-required）
 */
export function gateComputerCapability(request: GateCapabilityRequest): ComputerExecutionAttempt | null {
  const decision = evaluateComputerPolicy({
    capability: request.capability,
    mode: request.snapshot.agentMode,
    rules: request.livePermissionRules,
  });
  if (decision.effect === "allow") return null;
  if (decision.effect === "deny") {
    return denied(decision.reason);
  }
  const matchedIndex = request.oneShotApprovals.findIndex((approval) =>
    oneShotApprovalMatches(approval, {
      toolCallId: request.toolCallId,
      capability: request.capability,
      workspaceId: request.snapshot.workspaceId ?? "",
      ...(request.fingerprint !== undefined ? { fingerprint: request.fingerprint } : {}),
    })
  );
  if (matchedIndex !== -1) {
    request.oneShotApprovals.splice(matchedIndex, 1);
    return null;
  }
  return {
    kind: "approval-required",
    request: buildApprovalRequest({
      id: `approval-${crypto.randomUUID()}`,
      toolCallId: request.toolCallId,
      taskId: request.taskId,
      capability: request.capability,
      workspaceId: request.snapshot.workspaceId ?? "",
      workspaceLabel: request.workspaceLabel,
      resourceLabel: request.resourceLabel,
      description: request.description,
      ...(request.fingerprint !== undefined ? { fingerprint: request.fingerprint } : {}),
    }),
  };
}
