/**
 * Computer Use Phase 3 — 多窗口 / 应用控制工具执行（renderer 侧）。
 *
 * 工具：list_desktop_windows（只读）/ activate_window / open_application。
 * - 全部经 Desktop Computer Session Bridge（v3）→ Main native runtime
 * - policy / approval / audit 与 Filesystem / Terminal / GUI 共用同一条管线
 * - 应用只接受 logical app id；exe 路径在 schema + Main 双重拒绝
 */
import type { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import type { ComputerPermissionRule, KiroWorkspaceMeta } from "@/lib/ai/computer/types";
import type { ComputerOneShotApproval } from "@/lib/ai/computer/approval";
import type { ComputerExecutionAttempt } from "@/lib/ai/computer/result";
import { resolveDesktopObservationCapability } from "@/lib/ai/computer/desktopObservationCapability";
import { resolveGuiControlCapability } from "@/lib/ai/computer/gui/capability";
import { gateComputerCapability, denied, cancelled, bridgeFailureOutput } from "@/lib/ai/computer/gui/gate";
import {
  activateWindowSchema,
  listDesktopWindowsSchema,
  openApplicationSchema,
} from "@/lib/ai/computer/tools/schemas";
import { appendComputerAuditEntry } from "@/lib/ai/computer/audit";
import {
  getClassFlowDesktopComputerSessionBridge,
  getClassFlowDesktopComputerSessionBridge as getSessionBridge,
} from "@/lib/desktop/bridge";

export const LIST_DESKTOP_WINDOWS_TOOL_NAME = "list_desktop_windows";
export const ACTIVATE_WINDOW_TOOL_NAME = "activate_window";
export const OPEN_APPLICATION_TOOL_NAME = "open_application";

interface Counters {
  readCount: number;
  mutationCount: number;
  terminalCount: number;
}

export interface WindowToolRequest {
  toolCallId: string;
  toolInput: unknown;
  snapshot: KiroComputerTurnSnapshot;
  liveWorkspaces: KiroWorkspaceMeta[];
  livePermissionRules: ComputerPermissionRule[];
  counters: Counters;
  oneShotApprovals: ComputerOneShotApproval[];
  taskId: string;
  readLimitPerTurn: number;
  mutationLimitPerTurn: number;
  isCancelled?: () => boolean;
  now?: () => number;
}

function resolveSessionId(snapshot: KiroComputerTurnSnapshot): string | undefined {
  return typeof snapshot.desktopSessionId === "string" && /^cs-[A-Za-z0-9-]{8,64}$/.test(snapshot.desktopSessionId)
    ? snapshot.desktopSessionId
    : undefined;
}

function workspaceLabels(request: WindowToolRequest): { workspaceId: string; workspaceLabel: string } {
  const workspaceId = request.snapshot.workspaceId ?? "";
  const workspaceLabel = workspaceId
    ? (request.liveWorkspaces.find((w) => w.id === workspaceId)?.name ?? workspaceId)
    : "";
  return { workspaceId, workspaceLabel };
}

/** list_desktop_windows（只读；与 observe 共享 read 预算） */
export async function executeKiroListDesktopWindows(
  request: WindowToolRequest
): Promise<ComputerExecutionAttempt> {
  const now = request.now ?? (() => Date.now());
  if (request.isCancelled?.()) return cancelled();
  const parsed = listDesktopWindowsSchema.safeParse(request.toolInput ?? {});
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
  const sessionId = resolveSessionId(request.snapshot);
  let result: Awaited<ReturnType<typeof bridge.listWindows>>;
  try {
    result = await bridge.listWindows({ ...(sessionId ? { sessionId } : {}) });
  } catch (err) {
    return bridgeFailureOutput(err, "窗口列表读取失败。");
  }
  request.counters.readCount += 1;
  const { workspaceId, workspaceLabel } = workspaceLabels(request);
  void appendComputerAuditEntry({
    id: `audit-${crypto.randomUUID()}`,
    timestamp: new Date(now()).toISOString(),
    taskId: request.taskId,
    conversationId: null,
    toolCallId: request.toolCallId,
    toolName: LIST_DESKTOP_WINDOWS_TOOL_NAME,
    capability: "screen.observe",
    decision: "auto",
    outcome: "executed",
    workspaceId,
    workspaceLabel,
    ...(sessionId ? { sessionId } : {}),
    windowLabel: result.activeApplication || null,
  });
  return { kind: "completed", output: { ok: true, data: result } };
}

/** activate_window（切换前台窗口；activate → observe → action） */
export async function executeKiroActivateWindow(
  request: WindowToolRequest
): Promise<ComputerExecutionAttempt> {
  const now = request.now ?? (() => Date.now());
  if (request.isCancelled?.()) return cancelled();
  const parsed = activateWindowSchema.safeParse(request.toolInput ?? {});
  if (!parsed.success) {
    return { kind: "completed", output: { ok: false, code: "INVALID_INPUT", message: "输入不合法。" } };
  }
  const capability = resolveGuiControlCapability(request.snapshot);
  if (!capability.available) {
    return denied(
      capability.reason === "mode-read-only"
        ? "当前为仅规划模式，不能切换窗口。"
        : capability.reason === "permission-disabled"
          ? "用户尚未开启「允许 Kiro 操作电脑」。"
          : capability.reason === "observe-disabled"
            ? "用户尚未开启「允许 Kiro 查看桌面」。"
            : "当前运行环境没有电脑操作能力。"
    );
  }
  const bridge = getSessionBridge();
  if (!bridge) return denied("当前运行环境没有桌面会话能力。");
  if (request.counters.mutationCount >= request.mutationLimitPerTurn) {
    return denied(
      `本轮修改操作已达上限（${request.mutationLimitPerTurn}/${request.mutationLimitPerTurn}），请分步进行或开启新对话`
    );
  }
  const sessionId = resolveSessionId(request.snapshot);
  const { workspaceId, workspaceLabel } = workspaceLabels(request);
  const gate = gateComputerCapability({
    capability: "app.activate",
    toolCallId: request.toolCallId,
    snapshot: request.snapshot,
    livePermissionRules: request.livePermissionRules,
    oneShotApprovals: request.oneShotApprovals,
    taskId: request.taskId,
    description: `切换窗口 ${parsed.data.windowId}`,
    resourceLabel: parsed.data.windowId,
    workspaceLabel,
    fingerprint: `window:activate:${parsed.data.windowId}`,
  });
  if (gate) return gate;
  if (request.isCancelled?.()) return cancelled();
  let result: Awaited<ReturnType<typeof bridge.activateWindow>>;
  try {
    result = await bridge.activateWindow({
      windowId: parsed.data.windowId,
      ...(sessionId ? { sessionId } : {}),
    });
  } catch (err) {
    return bridgeFailureOutput(err, "窗口切换失败。");
  }
  request.counters.mutationCount += 1;
  void appendComputerAuditEntry({
    id: `audit-${crypto.randomUUID()}`,
    timestamp: new Date(now()).toISOString(),
    taskId: request.taskId,
    conversationId: null,
    toolCallId: request.toolCallId,
    toolName: ACTIVATE_WINDOW_TOOL_NAME,
    capability: "app.activate",
    decision: "auto",
    outcome: "executed",
    workspaceId,
    workspaceLabel,
    ...(sessionId ? { sessionId } : {}),
    logicalApp: result.appName || null,
    windowLabel: result.windowTitle || null,
  });
  return { kind: "completed", output: { ok: true, data: result } };
}

/** open_application（logical app id + allowlist 解析） */
export async function executeKiroOpenApplication(
  request: WindowToolRequest
): Promise<ComputerExecutionAttempt> {
  const now = request.now ?? (() => Date.now());
  if (request.isCancelled?.()) return cancelled();
  const parsed = openApplicationSchema.safeParse(request.toolInput ?? {});
  if (!parsed.success) {
    return {
      kind: "completed",
      output: {
        ok: false,
        code: "INVALID_INPUT",
        message: "只能使用逻辑应用名（例如 chrome / word / wechat），不要使用 exe 或文件路径。",
      },
    };
  }
  const capability = resolveGuiControlCapability(request.snapshot);
  if (!capability.available) {
    return denied(
      capability.reason === "mode-read-only"
        ? "当前为仅规划模式，不能打开应用。"
        : capability.reason === "permission-disabled"
          ? "用户尚未开启「允许 Kiro 操作电脑」。"
          : capability.reason === "observe-disabled"
            ? "用户尚未开启「允许 Kiro 查看桌面」。"
            : "当前运行环境没有电脑操作能力。"
    );
  }
  const bridge = getSessionBridge();
  if (!bridge) return denied("当前运行环境没有桌面会话能力。");
  if (request.counters.mutationCount >= request.mutationLimitPerTurn) {
    return denied(
      `本轮修改操作已达上限（${request.mutationLimitPerTurn}/${request.mutationLimitPerTurn}），请分步进行或开启新对话`
    );
  }
  const sessionId = resolveSessionId(request.snapshot);
  const { workspaceId, workspaceLabel } = workspaceLabels(request);
  const gate = gateComputerCapability({
    capability: "app.open",
    toolCallId: request.toolCallId,
    snapshot: request.snapshot,
    livePermissionRules: request.livePermissionRules,
    oneShotApprovals: request.oneShotApprovals,
    taskId: request.taskId,
    description: `打开应用 ${parsed.data.app}`,
    resourceLabel: parsed.data.app,
    workspaceLabel,
    fingerprint: `app:open:${parsed.data.app.toLowerCase()}`,
  });
  if (gate) return gate;
  if (request.isCancelled?.()) return cancelled();
  let result: Awaited<ReturnType<typeof bridge.openApplication>>;
  try {
    result = await bridge.openApplication({
      app: parsed.data.app,
      ...(sessionId ? { sessionId } : {}),
    });
  } catch (err) {
    return bridgeFailureOutput(err, "应用启动失败。");
  }
  request.counters.mutationCount += 1;
  void appendComputerAuditEntry({
    id: `audit-${crypto.randomUUID()}`,
    timestamp: new Date(now()).toISOString(),
    taskId: request.taskId,
    conversationId: null,
    toolCallId: request.toolCallId,
    toolName: OPEN_APPLICATION_TOOL_NAME,
    capability: "app.open",
    decision: "auto",
    outcome: "executed",
    workspaceId,
    workspaceLabel,
    ...(sessionId ? { sessionId } : {}),
    logicalApp: result.label,
    ...(result.windowId ? { windowLabel: result.windowId } : {}),
  });
  return { kind: "completed", output: { ok: true, data: result } };
}
