/**
 * Computer Use Phase 1 — observe_desktop Browser 侧执行（只读）。
 *
 * 链路：模型 → observe_desktop → executeKiroComputerTool → 本模块 → Desktop Computer Bridge
 *       → Windows Runtime → 脱敏 Observation → Tool Output。
 *
 * 安全：
 * - 只调用 Bridge 的结构化 observe API；不接触 HWND / PID / native handle
 * - 截图 dataUrl 不进入模型输出（避免无界 token）；只保留 evidence metadata（尺寸/字节/时间）
 * - ask policy 走现有 approval lifecycle；deny 绝不执行
 * - 本阶段没有任何鼠标 / 键盘 / clipboard / launch app 调用路径
 */
import {
  ComputerPermissionRule,
  ComputerCapability,
  KiroWorkspaceMeta,
} from "@/lib/ai/computer/types";
import { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import { evaluateComputerPolicy } from "@/lib/ai/computer/policy";
import { observeDesktopSchema } from "@/lib/ai/computer/tools/schemas";
import { resolveDesktopObservationCapability } from "@/lib/ai/computer/desktopObservationCapability";
import { getClassFlowDesktopComputerBridge } from "@/lib/desktop/bridge";
import { appendComputerAuditEntry } from "@/lib/ai/computer/audit";
import {
  ComputerOneShotApproval,
  buildApprovalRequest,
  oneShotApprovalMatches,
} from "@/lib/ai/computer/approval";
import type { ComputerExecutionAttempt } from "@/lib/ai/computer/result";

export const OBSERVE_DESKTOP_TOOL_NAME = "observe_desktop";

export interface ObserveDesktopCounters {
  readCount: number;
  mutationCount: number;
  terminalCount: number;
}

export interface ExecuteObserveDesktopRequest {
  toolCallId: string;
  toolInput: unknown;
  snapshot: KiroComputerTurnSnapshot;
  liveWorkspaces: KiroWorkspaceMeta[];
  livePermissionRules: ComputerPermissionRule[];
  counters: ObserveDesktopCounters;
  oneShotApprovals: ComputerOneShotApproval[];
  taskId: string;
  /** read 上限（与 executor 的 COMPUTER_READ_LIMIT_PER_TURN 一致；参数化避免循环依赖） */
  readLimitPerTurn: number;
  now?: () => number;
}

function denied(message: string): ComputerExecutionAttempt {
  return { kind: "completed", output: { ok: false, code: "PERMISSION_DENIED", message } };
}

interface BridgeFailure {
  code?: unknown;
  message?: unknown;
}

/** Bridge error → model-safe Tool Output code（未知 → OBSERVATION_FAILED；绝不透传 raw error） */
function bridgeFailureOutput(err: unknown): ComputerExecutionAttempt {
  const failure = (err ?? {}) as BridgeFailure;
  const code = typeof failure.code === "string" ? failure.code : "OBSERVATION_FAILED";
  const message =
    typeof failure.message === "string" && failure.message
      ? failure.message
      : "桌面观察失败。";
  return { kind: "completed", output: { ok: false, code, message } };
}

/**
 * 单个 capability 的 policy 求值 + approval 生命周期。
 * @returns null = 可继续执行；否则返回终结 attempt（deny / approval-required）
 */
function gateCapability(request: {
  capability: ComputerCapability;
  toolCallId: string;
  snapshot: KiroComputerTurnSnapshot;
  livePermissionRules: ComputerPermissionRule[];
  oneShotApprovals: ComputerOneShotApproval[];
  taskId: string;
  description: string;
  resourceLabel: string;
  workspaceLabel: string;
}): ComputerExecutionAttempt | null {
  const decision = evaluateComputerPolicy({
    capability: request.capability,
    mode: request.snapshot.agentMode,
    rules: request.livePermissionRules,
  });
  if (decision.effect === "allow") return null;
  if (decision.effect === "deny") {
    return denied(decision.reason);
  }
  // ask：one-shot（approval resume）→ 消费后继续；否则 approval-required
  const matchedIndex = request.oneShotApprovals.findIndex((approval) =>
    oneShotApprovalMatches(approval, {
      toolCallId: request.toolCallId,
      capability: request.capability,
      workspaceId: request.snapshot.workspaceId ?? "",
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
    }),
  };
}

export async function executeKiroObserveDesktop(
  request: ExecuteObserveDesktopRequest
): Promise<ComputerExecutionAttempt> {
  const now = request.now ?? (() => Date.now());

  // 1. schema（strict；模型只能给 opaque windowId）
  const parsed = observeDesktopSchema.safeParse(request.toolInput ?? {});
  if (!parsed.success) {
    return {
      kind: "completed",
      output: { ok: false, code: "INVALID_INPUT", message: "观察桌面的输入不合法。" },
    };
  }
  const input = parsed.data;

  // 2. Capability Gate（runtime 第二道；server tool exposure 是第一道）
  const capability = resolveDesktopObservationCapability(request.snapshot);
  if (!capability.available) {
    const message =
      capability.reason === "permission-disabled"
        ? "用户尚未开启「允许 Kiro 查看桌面」。"
        : capability.reason === "runtime-unavailable"
          ? "当前运行环境没有桌面观察能力。"
          : "Computer Agent 未启用。";
    return denied(message);
  }

  // 3. Bridge（Web runtime / 旧 Desktop → null）
  const bridge = getClassFlowDesktopComputerBridge();
  if (!bridge) return denied("当前运行环境没有桌面观察能力。");

  // 4. policy（只读观察；Plan / Guided / Workspace Auto 默认 allow；explicit deny 权威）
  const includeUiTree = input.includeUiTree !== false;
  const targetLabel = input.windowId
    ? "指定窗口"
    : input.target === "screen"
      ? "整个屏幕"
      : "当前窗口";
  const workspaceId = request.snapshot.workspaceId ?? "";
  const workspaceLabel = workspaceId
    ? (request.liveWorkspaces.find((w) => w.id === workspaceId)?.name ?? workspaceId)
    : "";
  const observeGate = gateCapability({
    capability: "screen.observe",
    toolCallId: request.toolCallId,
    snapshot: request.snapshot,
    livePermissionRules: request.livePermissionRules,
    oneShotApprovals: request.oneShotApprovals,
    taskId: request.taskId,
    description: `观察桌面（${targetLabel}）`,
    resourceLabel: targetLabel,
    workspaceLabel,
  });
  if (observeGate) return observeGate;
  if (includeUiTree) {
    const inspectGate = gateCapability({
      capability: "ui.inspect",
      toolCallId: request.toolCallId,
      snapshot: request.snapshot,
      livePermissionRules: request.livePermissionRules,
      oneShotApprovals: request.oneShotApprovals,
      taskId: request.taskId,
      description: "读取窗口界面控件树",
      resourceLabel: targetLabel,
      workspaceLabel,
    });
    if (inspectGate) return inspectGate;
  }

  // 5. read 预算（只读观察消耗 readCount；超限拒绝）
  if (request.counters.readCount >= request.readLimitPerTurn) {
    return denied("本轮读取操作已达上限。");
  }

  // 6. Bridge observe（唯一 IO；失败 → 结构化 Tool Output）
  let observation: Awaited<ReturnType<typeof bridge.observe>>;
  try {
    observation = await bridge.observe({
      target: input.target ?? "active-window",
      ...(input.windowId ? { windowId: input.windowId } : {}),
      includeScreenshot: input.includeScreenshot !== false,
      includeUiTree,
    });
  } catch (err) {
    return bridgeFailureOutput(err);
  }
  request.counters.readCount += 1;

  const screenshotEvidence = observation.screenshot
    ? {
        captured: true as const,
        mimeType: observation.screenshot.mimeType,
        width: observation.screenshot.width,
        height: observation.screenshot.height,
        bytes: observation.screenshot.bytes,
        capturedAt: observation.screenshot.capturedAt,
      }
    : { captured: false as const };

  // 7. Audit（只读执行事实；observationId 为 opaque；绝不含 native 标识 / 像素）
  void appendComputerAuditEntry({
    id: `audit-${crypto.randomUUID()}`,
    timestamp: new Date(now()).toISOString(),
    taskId: request.taskId,
    conversationId: null,
    toolCallId: request.toolCallId,
    toolName: OBSERVE_DESKTOP_TOOL_NAME,
    capability: "screen.observe",
    decision: "auto",
    outcome: "executed",
    workspaceId,
    workspaceLabel,
    observationId: observation.observationId,
    desktopTarget: observation.target,
    uiElementCount: observation.elementCount,
  });

  return {
    kind: "completed",
    output: {
      ok: true,
      data: {
        observationId: observation.observationId,
        target: observation.target,
        appName: observation.appName,
        windowTitle: observation.windowTitle,
        windowId: observation.windowId,
        viewport: observation.viewport,
        windows: observation.windows,
        windowsTruncated: observation.windowsTruncated,
        elements: observation.elements,
        elementCount: observation.elementCount,
        elementsTruncated: observation.elementsTruncated,
        screenshot: screenshotEvidence,
        warnings: observation.warnings,
        uiTreeRevision: observation.uiTreeRevision,
        capturedAt: observation.capturedAt,
        // 明确阶段边界：模型必须如实告知用户当前不能执行 GUI 操作
        readOnly: true,
      },
    },
  };
}
