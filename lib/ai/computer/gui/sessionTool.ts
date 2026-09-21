/**
 * Computer Use V2.3 — desktop_session 执行（会话计划元数据，只读/控制，不执行 GUI）。
 *
 * 目标 / 计划 / 当前步骤只存在于 Main 的 DesktopControlSession（runtime memory，不持久化）；
 * 本工具不消耗 read/mutation 预算（不是界面观察，也不是 GUI 副作用）。
 */
import type { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import type { ComputerPermissionRule, KiroWorkspaceMeta } from "@/lib/ai/computer/types";
import type { ComputerExecutionAttempt } from "@/lib/ai/computer/result";
import { resolveDesktopObservationCapability } from "@/lib/ai/computer/desktopObservationCapability";
import { desktopSessionSchema } from "@/lib/ai/computer/tools/schemas";
import { appendComputerAuditEntry } from "@/lib/ai/computer/audit";
import { getClassFlowDesktopComputerSessionBridge } from "@/lib/desktop/bridge";
import { denied, cancelled, bridgeFailureOutput } from "@/lib/ai/computer/gui/gate";

export const DESKTOP_SESSION_TOOL_NAME = "desktop_session";

export interface DesktopSessionToolRequest {
  toolCallId: string;
  toolInput: unknown;
  snapshot: KiroComputerTurnSnapshot;
  liveWorkspaces: KiroWorkspaceMeta[];
  taskId: string;
  isCancelled?: () => boolean;
  now?: () => number;
}

export async function executeKiroDesktopSession(
  request: DesktopSessionToolRequest
): Promise<ComputerExecutionAttempt> {
  const now = request.now ?? (() => Date.now());
  if (request.isCancelled?.()) return cancelled();

  const parsed = desktopSessionSchema.safeParse(request.toolInput ?? {});
  if (!parsed.success) {
    return { kind: "completed", output: { ok: false, code: "INVALID_INPUT", message: "desktop_session 输入不合法。" } };
  }

  const capability = resolveDesktopObservationCapability(request.snapshot);
  if (!capability.available) {
    return denied(
      capability.reason === "permission-disabled"
        ? "用户尚未开启「允许 Kiro 查看桌面」。"
        : capability.reason === "runtime-unavailable"
          ? "当前运行环境没有桌面会话能力。"
          : "Computer Agent 未启用。"
    );
  }

  const bridge = getClassFlowDesktopComputerSessionBridge();
  if (!bridge) return denied("当前运行环境没有桌面会话能力。");

  const sessionId =
    typeof request.snapshot.desktopSessionId === "string" &&
    /^cs-[A-Za-z0-9-]{8,64}$/.test(request.snapshot.desktopSessionId)
      ? request.snapshot.desktopSessionId
      : undefined;
  if (!sessionId) return denied("当前 Turn 没有 Desktop Control session。");

  const input = parsed.data;
  let status: Awaited<ReturnType<typeof bridge.updateSessionPlan>>;
  try {
    status = await bridge.updateSessionPlan({
      sessionId,
      ...(input.action === "set_goal" && input.goal ? { goal: input.goal } : {}),
      ...(input.action === "update_plan" && input.plan ? { plan: input.plan } : {}),
      ...(input.action === "set_step" && input.stepIndex !== undefined
        ? { stepIndex: input.stepIndex }
        : {}),
      ...(input.action === "complete_step" ? { completeStep: true } : {}),
    });
  } catch (err) {
    return bridgeFailureOutput(err, "更新会话计划失败。");
  }

  const workspaceId = request.snapshot.workspaceId ?? "";
  const workspaceLabel = workspaceId
    ? (request.liveWorkspaces.find((w) => w.id === workspaceId)?.name ?? workspaceId)
    : "";
  void appendComputerAuditEntry({
    id: `audit-${crypto.randomUUID()}`,
    timestamp: new Date(now()).toISOString(),
    taskId: request.taskId,
    conversationId: null,
    toolCallId: request.toolCallId,
    toolName: DESKTOP_SESSION_TOOL_NAME,
    capability: "ui.inspect",
    decision: "auto",
    outcome: "executed",
    workspaceId,
    workspaceLabel,
    sessionId,
    stepIndex: status.stepIndex,
    planHash: hashPlan(status.plan),
  });

  return {
    kind: "completed",
    output: {
      ok: true,
      data: {
        sessionId: status.sessionId,
        goal: status.goal,
        plan: status.plan,
        stepIndex: status.stepIndex,
        currentStep: status.plan[status.stepIndex] ?? null,
        reflectionRequired: status.reflectionRequired,
        state: status.state,
        remainingActions: status.remainingActions,
      },
    },
  };
}

/** 计划短哈希（Audit 用；不含步骤原文） */
export function hashPlan(plan: readonly string[]): string {
  const flat = plan.join("|");
  let hash = 0;
  for (let i = 0; i < flat.length; i++) hash = (hash * 31 + flat.charCodeAt(i)) >>> 0;
  return `${hash.toString(16)}:${plan.length}`;
}
