/**
 * Computer Use Phase 2 — desktop_action Browser 侧执行。
 *
 * 链路：
 *   模型 → desktop_action → executeKiroComputerTool → 本模块
 *   → Capability / Policy / Approval → Desktop Computer Action Bridge
 *   → Main（观察强绑定校验 + native 执行 + settle + 自动重新观察）→ Tool Output
 *
 * 安全：
 * - 所有输入由 Main / native runtime 执行；renderer 无 unrestricted input API
 * - 风险事实来自 Main（真实控件），renderer 只做策略合成，不能伪造 / 降低风险
 * - blocked（密码 / 密钥 / 提权 / clipboard）直接拒绝，审批也不放行
 * - 高风险动作（external / destructive / sensitive）强制审批且只允许 deny / allow-once
 * - Stop 后（isCancelled）拒绝执行；Main 侧 session cancel 同样拒绝
 */
import { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import { ComputerPermissionRule, KiroWorkspaceMeta } from "@/lib/ai/computer/types";
import { evaluateComputerPolicy } from "@/lib/ai/computer/policy";
import { desktopActionSchema } from "@/lib/ai/computer/tools/schemas";
import { resolveGuiControlCapability } from "@/lib/ai/computer/gui/capability";
import { isHighRiskGuiLevel } from "@/lib/ai/computer/gui/risk";
import { buildGuiApprovalInfo, describeGuiAction } from "@/lib/ai/computer/gui/observation";
import { hashPlan } from "@/lib/ai/computer/gui/sessionTool";
import {
  DESKTOP_ACTION_TOOL_NAME,
  type ExecuteDesktopActionRequest,
} from "@/lib/ai/computer/gui/types";
import { getClassFlowDesktopComputerActionBridge, nativeGrantIdFromAdapterRef } from "@/lib/desktop/bridge";
import { summarizeObservation } from "@/lib/ai/computer/desktop/summary";
import { appendComputerAuditEntry } from "@/lib/ai/computer/audit";
import {
  ComputerApprovalDecision,
  ComputerOneShotApproval,
  buildApprovalRequest,
  oneShotApprovalMatches,
} from "@/lib/ai/computer/approval";
import type { ComputerExecutionAttempt } from "@/lib/ai/computer/result";

function denied(message: string, code = "PERMISSION_DENIED"): ComputerExecutionAttempt {
  return { kind: "completed", output: { ok: false, code, message } };
}

function cancelled(): ComputerExecutionAttempt {
  return {
    kind: "completed",
    output: { ok: false, code: "CANCELLED", message: "用户已停止电脑操作。" },
  };
}

/** Bridge error → model-safe Tool Output（保留结构化 code；绝不透传 raw error） */
function bridgeFailureOutput(err: unknown): ComputerExecutionAttempt {
  const failure = (err ?? {}) as { code?: unknown; message?: unknown };
  const code = typeof failure.code === "string" ? failure.code : "ACTION_FAILED";
  const message =
    code === "STALE_OBSERVATION"
      ? "界面已变化，请重新 observe_desktop 后再操作。"
      : typeof failure.message === "string" && failure.message
        ? failure.message
        : "电脑操作失败。";
  return { kind: "completed", output: { ok: false, code, message } };
}

function capabilityDeniedMessage(reason: string): string {
  switch (reason) {
    case "observe-disabled":
      return "用户尚未开启「允许 Kiro 查看桌面」。";
    case "permission-disabled":
      return "用户尚未开启「允许 Kiro 操作电脑」。";
    case "runtime-unavailable":
      return "当前运行环境没有电脑操作能力。";
    case "mode-read-only":
      return "当前为仅规划模式，只能观察，不能操作电脑。";
    default:
      return "Computer Agent 未启用。";
  }
}

/**
 * V2.5：upload_file 的 rootId → native grantId 解析（renderer 侧；绝不产生绝对路径）。
 * 只接受已授权的本机（native）工作区根；沙盒 / 浏览器工作区不支持。
 */
function resolveUploadFileRoot(
  request: ExecuteDesktopActionRequest,
  rootId: string | undefined
):
  | { ok: true; grantId: string }
  | { ok: false; code: "PERMISSION_DENIED" | "INVALID_INPUT"; message: string } {
  const workspace = request.liveWorkspaces.find((w) => w.id === (request.snapshot.workspaceId ?? ""));
  const roots = workspace?.roots ?? [];
  if (roots.length === 0) {
    return { ok: false, code: "PERMISSION_DENIED", message: "当前没有可用的工作区文件夹。" };
  }
  const root = rootId ? roots.find((r) => r.id === rootId) : roots.length === 1 ? roots[0] : undefined;
  if (!root) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: rootId ? "指定的工作区文件夹不存在。" : "工作区有多个文件夹，请提供 rootId。",
    };
  }
  const grantId = nativeGrantIdFromAdapterRef(root.adapterRef);
  if (!grantId) {
    return {
      ok: false,
      code: "PERMISSION_DENIED",
      message: "文件上传仅支持本机工作区文件夹（当前工作区不是本机目录）。",
    };
  }
  return { ok: true, grantId };
}

export async function executeKiroDesktopAction(
  request: ExecuteDesktopActionRequest
): Promise<ComputerExecutionAttempt> {
  const now = request.now ?? (() => Date.now());
  if (request.isCancelled?.()) return cancelled();

  // 1. schema（strict + 动作专属字段 / 按键 allowlist）
  const parsed = desktopActionSchema.safeParse(request.toolInput ?? {});
  if (!parsed.success) {
    return {
      kind: "completed",
      output: { ok: false, code: "INVALID_INPUT", message: "操作电脑的输入不合法。" },
    };
  }
  const input = parsed.data;

  // 2. Capability Gate（runtime 第二道；server tool exposure 是第一道）
  const capability = resolveGuiControlCapability(request.snapshot);
  if (!capability.available) {
    return denied(capabilityDeniedMessage(capability.reason));
  }

  // 3. Bridge（version >= 2 + action surface；Web / 旧 Desktop → null）
  const bridge = getClassFlowDesktopComputerActionBridge();
  if (!bridge) return denied("当前运行环境没有电脑操作能力。");

  // 4. Policy（ui.interact：Plan deny / Guided ask / Workspace Auto allow）
  const policy = evaluateComputerPolicy({
    capability: "ui.interact",
    mode: request.snapshot.agentMode,
    rules: request.livePermissionRules,
  });
  if (policy.effect === "deny") {
    return denied(policy.reason);
  }

  // 5. mutation 预算（动作有副作用；wait 也计入保持循环有界）
  if (request.counters.mutationCount >= request.mutationLimitPerTurn) {
    return denied(
      `本轮修改操作已达上限（${request.mutationLimitPerTurn}/${request.mutationLimitPerTurn}），请分步进行或开启新对话`
    );
  }

  const snapshot: KiroComputerTurnSnapshot = request.snapshot;
  const sessionId =
    typeof snapshot.desktopSessionId === "string" && /^cs-[A-Za-z0-9-]{8,64}$/.test(snapshot.desktopSessionId)
      ? snapshot.desktopSessionId
      : undefined;

  // 5b. V2.5：剪贴板默认关闭（设置未开启 → 直接拒绝，不进入 Main）
  const clipboardAction = input.action === "clipboard_read" || input.action === "clipboard_write";
  if (clipboardAction && snapshot.desktopClipboardEnabled !== true) {
    return denied("用户尚未开启剪贴板访问（设置 → Kiro → 允许剪贴板读写）。");
  }

  // 5c. V2.5：upload_file 需要工作区文件（rootId → adapterRef → native grantId）
  let fileGrant: { grantId: string; path: string } | undefined;
  if (input.action === "upload_file") {
    const file = input.file;
    if (!file) {
      return denied("upload_file 必须提供 file（工作区文件）。", "INVALID_INPUT");
    }
    const resolvedRoot = resolveUploadFileRoot(request, file.rootId);
    if (!resolvedRoot.ok) return denied(resolvedRoot.message, resolvedRoot.code);
    fileGrant = { grantId: resolvedRoot.grantId, path: file.path };
  }

  const bridgeInput = {
    ...input,
    ...(sessionId ? { sessionId } : {}),
    ...(clipboardAction ? { clipboardAllowed: true } : {}),
    ...(fileGrant ? { fileGrant } : {}),
  };

  // 6a. wait：无 target / 无副作用 → 不经过审批与观察强绑定（Main 仅做 session 校验）
  if (input.action === "wait") {
    if (request.isCancelled?.()) return cancelled();
    let waitResult: Awaited<ReturnType<typeof bridge.action>>;
    try {
      waitResult = await bridge.action(bridgeInput);
    } catch (err) {
      return bridgeFailureOutput(err);
    }
    request.counters.mutationCount += 1;
    void appendComputerAuditEntry({
      id: `audit-${crypto.randomUUID()}`,
      timestamp: new Date(now()).toISOString(),
      taskId: request.taskId,
      conversationId: null,
      toolCallId: request.toolCallId,
      toolName: DESKTOP_ACTION_TOOL_NAME,
      capability: "ui.interact",
      decision: "auto",
      outcome: "executed",
      workspaceId: snapshot.workspaceId ?? "",
      workspaceLabel: "",
      guiAction: "wait",
      guiRisk: "normal",
      guiMethod: waitResult.actionResult.method,
    });
    return {
      kind: "completed",
      output: {
        ok: true,
        data: {
          action: { type: "wait", method: waitResult.actionResult.method, targetLabel: "等待", durationMs: waitResult.actionResult.durationMs },
          risk: { level: "normal", reason: "等待（无输入）" },
          changedWindow: null,
          uiChanged: null,
          observation: null,
          observationId: null,
          verification: "none",
          readOnly: false,
        },
      },
    };
  }

  // 6. Main 只读校验 + 风险事实（观察强绑定在这里完成）
  let preparation: Awaited<ReturnType<typeof bridge.prepareAction>>;
  try {
    preparation = await bridge.prepareAction(bridgeInput);
  } catch (err) {
    return bridgeFailureOutput(err);
  }

  // 7. blocked：密码 / API Key / Token / Secret / 提权 / clipboard —— 审批也不放行
  if (preparation.risk.level === "blocked") {
    return denied(`此操作被禁止：${preparation.risk.reason}`, "ACTION_BLOCKED");
  }

  // 8. 审批决策：
  //    - 高风险（external/destructive/sensitive）→ 强制审批，且只允许 deny / allow-once
  //    - 普通 + Guided ask → 沿用现有审批模式
  //    - wait 无副作用，policy ask 时不额外确认
  const highRisk = isHighRiskGuiLevel(preparation.risk.level);
  const requiresApproval =
    preparation.action === "wait" ? false : highRisk || policy.effect === "ask";
  const workspaceId = snapshot.workspaceId ?? "";
  const workspaceLabel = workspaceId
    ? (request.liveWorkspaces.find((w) => w.id === workspaceId)?.name ?? workspaceId)
    : "";
  // V2.5：drag / upload_file 的审批指纹必须绑定落点 / 文件（防止 allow-once 被复用到其它目标）
  const dragTo =
    input.action === "drag" && input.to
      ? `->${input.to.elementId ?? (input.to.normalized ? `${input.to.normalized.x.toFixed(2)},${input.to.normalized.y.toFixed(2)}` : "none")}`
      : "";
  const uploadPart =
    input.action === "upload_file" && input.file
      ? `:${input.file.rootId ?? "auto"}:${input.file.path.length}:${input.file.path.slice(-24)}`
      : "";
  const fingerprint = `gui:${preparation.action}:${preparation.target.kind}:${preparation.target.elementId ?? "none"}${dragTo}${uploadPart}`;

  if (requiresApproval) {
    const matchedIndex = request.oneShotApprovals.findIndex((approval) =>
      oneShotApprovalMatches(approval, {
        toolCallId: request.toolCallId,
        capability: "ui.interact",
        workspaceId,
        fingerprint,
      })
    );
    if (matchedIndex === -1) {
      const allowedDecisions: ComputerApprovalDecision[] | undefined = highRisk
        ? ["deny", "allow-once"]
        : undefined;
      return {
        kind: "approval-required",
        request: buildApprovalRequest({
          id: `approval-${crypto.randomUUID()}`,
          toolCallId: request.toolCallId,
          taskId: request.taskId,
          capability: "ui.interact",
          workspaceId,
          workspaceLabel,
          resourceLabel: preparation.target.targetLabel,
          description: `${describeGuiAction(preparation)}${
            preparation.risk.level !== "normal" ? `（${preparation.risk.reason}）` : ""
          }`,
          fingerprint,
          ...(allowedDecisions ? { allowedDecisions } : {}),
          gui: buildGuiApprovalInfo(preparation),
        }),
      };
    }
    request.oneShotApprovals.splice(matchedIndex, 1);
  }

  if (request.isCancelled?.()) return cancelled();

  // 9. 执行（Main 内部重复完整校验：过期 / 窗口 / 元素 / bounds）
  let result: Awaited<ReturnType<typeof bridge.action>>;
  try {
    result = await bridge.action(bridgeInput);
  } catch (err) {
    return bridgeFailureOutput(err);
  }
  request.counters.mutationCount += 1;

  // 10. Audit（GUI 事实；绝不记录输入文本 / native 标识）
  void appendComputerAuditEntry({
    id: `audit-${crypto.randomUUID()}`,
    timestamp: new Date(now()).toISOString(),
    taskId: request.taskId,
    conversationId: null,
    toolCallId: request.toolCallId,
    toolName: DESKTOP_ACTION_TOOL_NAME,
    capability: "ui.interact",
    decision: requiresApproval ? "allow-once" : "auto",
    outcome: "executed",
    workspaceId,
    workspaceLabel,
    guiAction: preparation.action,
    guiRisk: preparation.risk.level,
    guiMethod: result.actionResult.method,
    ...(result.changedWindow !== null ? { changedWindow: result.changedWindow } : {}),
    ...(result.uiChanged !== null ? { uiChanged: result.uiChanged } : {}),
    ...(result.verification !== undefined ? { verificationPassed: result.verification.passed } : {}),
    ...(result.session
      ? { stepIndex: result.session.stepIndex, planHash: hashPlan(result.session.plan) }
      : {}),
  });

  // 11. Observe → Action → Observe：返回 action result + 新 observation
  return {
    kind: "completed",
    output: {
      ok: true,
      data: {
        action: {
          type: preparation.action,
          method: result.actionResult.method,
          targetLabel: preparation.target.targetLabel,
          durationMs: result.actionResult.durationMs,
        },
        risk: preparation.risk,
        changedWindow: result.changedWindow,
        uiChanged: result.uiChanged,
        observation: result.observation ? summarizeObservation(result.observation) : null,
        observationId: result.newObservationId,
        /** V2.1：expect 求值结果（null = 未配置 expect） */
        verification: result.verification ?? null,
        /** 是否通过验证（null = 未配置）；false 时必须重新观察 / 换策略，不得宣称完成 */
        expectationPassed: result.verification ? result.verification.passed : null,
        reobserve: result.newObservationId ? "re-observed" : "none",
        ...(result.reflectionRequired
          ? { reflectionRequired: true, reflectionHint: result.reflectionHint }
          : {}),
        /** V2.5：clipboard_read 文本（≤4096 字符；仅审批通过后返回） */
        ...(result.clipboardText !== undefined ? { clipboardText: result.clipboardText } : {}),
        /** V2.5：upload_file 回执（只回逻辑路径，绝不回绝对路径） */
        ...(input.action === "upload_file" && input.file
          ? { uploadedFile: { rootId: input.file.rootId ?? null, path: input.file.path } }
          : {}),
        readOnly: false,
      },
    },
  };
}
