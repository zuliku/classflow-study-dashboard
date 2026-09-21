/**
 * Computer Use V2.1 — find_desktop_element 执行（只读）。
 *
 * 在最近一次 observe_desktop 的控件树内做确定性检索：
 * 模型不需要在长列表里"肉眼"找目标，也不需要猜坐标。
 */
import type { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import type { ComputerPermissionRule, KiroWorkspaceMeta } from "@/lib/ai/computer/types";
import type { ComputerExecutionAttempt } from "@/lib/ai/computer/result";
import { resolveDesktopObservationCapability } from "@/lib/ai/computer/desktopObservationCapability";
import { findDesktopElementSchema } from "@/lib/ai/computer/tools/schemas";
import { appendComputerAuditEntry } from "@/lib/ai/computer/audit";
import { getClassFlowDesktopComputerSessionBridge } from "@/lib/desktop/bridge";
import { denied, cancelled, bridgeFailureOutput } from "@/lib/ai/computer/gui/gate";

export const FIND_DESKTOP_ELEMENT_TOOL_NAME = "find_desktop_element";

export interface FindDesktopElementRequest {
  toolCallId: string;
  toolInput: unknown;
  snapshot: KiroComputerTurnSnapshot;
  liveWorkspaces: KiroWorkspaceMeta[];
  counters: { readCount: number; mutationCount: number; terminalCount: number };
  taskId: string;
  readLimitPerTurn: number;
  isCancelled?: () => boolean;
  now?: () => number;
}

export async function executeKiroFindDesktopElement(
  request: FindDesktopElementRequest
): Promise<ComputerExecutionAttempt> {
  const now = request.now ?? (() => Date.now());
  if (request.isCancelled?.()) return cancelled();

  const parsed = findDesktopElementSchema.safeParse(request.toolInput ?? {});
  if (!parsed.success) {
    return { kind: "completed", output: { ok: false, code: "INVALID_INPUT", message: "输入不合法。" } };
  }

  const capability = resolveDesktopObservationCapability(request.snapshot);
  if (!capability.available) {
    return denied(
      capability.reason === "permission-disabled"
        ? "用户尚未开启「允许 Kiro 查看桌面」。"
        : capability.reason === "runtime-unavailable"
          ? "当前运行环境没有桌面观察能力。"
          : "Computer Agent 未启用。"
    );
  }

  const bridge = getClassFlowDesktopComputerSessionBridge();
  if (!bridge) return denied("当前运行环境没有桌面会话能力。");

  if (request.counters.readCount >= request.readLimitPerTurn) {
    return denied("本轮读取操作已达上限。");
  }

  const sessionId =
    typeof request.snapshot.desktopSessionId === "string" &&
    /^cs-[A-Za-z0-9-]{8,64}$/.test(request.snapshot.desktopSessionId)
      ? request.snapshot.desktopSessionId
      : undefined;

  let result: Awaited<ReturnType<typeof bridge.findElements>>;
  try {
    result = await bridge.findElements({
      observationId: parsed.data.observationId,
      query: parsed.data.query,
      ...(parsed.data.maxResults !== undefined ? { maxResults: parsed.data.maxResults } : {}),
      ...(sessionId ? { sessionId } : {}),
    });
  } catch (err) {
    return bridgeFailureOutput(err, "控件检索失败。");
  }
  request.counters.readCount += 1;

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
    toolName: FIND_DESKTOP_ELEMENT_TOOL_NAME,
    capability: "ui.inspect",
    decision: "auto",
    outcome: "executed",
    workspaceId,
    workspaceLabel,
    observationId: result.observationId,
    uiElementCount: result.totalElements,
    ...(sessionId ? { sessionId } : {}),
  });

  return {
    kind: "completed",
    output: {
      ok: true,
      data: {
        observationId: result.observationId,
        query: result.query,
        matches: result.matches,
        matchCount: result.matches.length,
        totalElements: result.totalElements,
        hint:
          result.matches.length > 0
            ? "使用 matches 中的 elementId 调用 desktop_action；不要使用其它观察的 elementId。"
            : "没有匹配控件；可换关键词、重新 observe_desktop，或用 list_desktop_windows 切换窗口。",
      },
    },
  };
}
