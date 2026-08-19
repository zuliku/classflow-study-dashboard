/**
 * Desktop Terminal V1 — Terminal Tool Executor（Command Runner；非交互 PTY）。
 *
 * 安全管线（Part 13）：
 * Tool schema → enabled → terminal availability（live bridge + snapshot preference）
 * → workspace/root → cwd sandbox（normalizeRelativeComputerPath；绝不到达 bridge）
 * → Native root only → policy shell.execute → Terminal Risk Gate
 * → approval（allow-once only；fingerprint = shell/rootId/cwd/command）
 * → bridge.terminal.execute（bounds / ANSI strip / timeout）→ audit + knowledge dirty
 *
 * 明确边界：Filesystem Adapter（root + relative path 强约束）与 Terminal
 * （cwd 在 workspace 内，但命令本身可能访问系统其它位置）不是同一个 sandbox guarantee。
 * Terminal 是 Privileged Desktop Capability——UI/文档绝不声称「终端只能访问这个文件夹」。
 */
import { KiroWorkspaceMeta, ComputerPermissionRule } from "@/lib/ai/computer/types";
import { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import { ComputerError } from "@/lib/ai/computer/errors";
import {
  ComputerExecutionAttempt,
  ComputerToolResult,
} from "@/lib/ai/computer/result";
import {
  buildApprovalRequest,
  ComputerOneShotApproval,
  oneShotApprovalMatches,
} from "@/lib/ai/computer/approval";
import { evaluateComputerPolicy } from "@/lib/ai/computer/policy";
import { normalizeRelativeComputerPath } from "@/lib/ai/computer/workspace/resolver";
import { getClassFlowDesktopTerminalBridge, getClassFlowDesktopTerminalBridgeV2 } from "@/lib/desktop/bridge";
import { nativeGrantIdFromAdapterRef, isNativeAdapterRef } from "@/lib/desktop/bridge";
import {
  ClassFlowDesktopTerminalShell,
  DesktopTerminalBridgeError,
  DesktopTerminalEvent,
} from "@/lib/desktop/types";
import { classifyTerminalCommandRisk, TerminalCommandRisk } from "@/lib/ai/computer/terminal/risk";
import { redactCommandPreview, redactTerminalSecrets, sanitizeTerminalModelOutput } from "@/lib/ai/computer/terminal/redact";
import { TerminalActivityInit } from "@/lib/ai/computer/terminal/activity";
import { createInteractiveHandle, setInteractivePromise, getInteractiveRecord, deleteInteractiveHandle, activeInteractiveHandleCount, resolveInteractiveHandle, rejectInteractiveHandle } from "@/lib/ai/computer/terminal/interactiveRegistry";
import { appendComputerAuditEntry } from "@/lib/ai/computer/audit";
import { markWorkspaceKnowledgeDirty } from "@/lib/ai/computer/knowledge/service";
import { runTerminalCommandSchema, writeTerminalInputSchema, startTerminalCommandSchema, waitTerminalCommandSchema, createTerminalSessionSchema, runTerminalSessionCommandSchema, writeTerminalSessionInputSchema, closeTerminalSessionSchema } from "@/lib/ai/computer/tools/schemas";

export const COMPUTER_TERMINAL_LIMIT_PER_TURN = 12;
export const MAX_TERMINAL_COMMAND_CHARS = 8192;
export const MAX_TERMINAL_STDOUT_CHARS = 32_000;
export const MAX_TERMINAL_STDERR_CHARS = 32_000;
export const DEFAULT_TERMINAL_TIMEOUT_MS = 30_000;
export const MIN_TERMINAL_TIMEOUT_MS = 1_000;
export const MAX_TERMINAL_TIMEOUT_MS = 120_000;
export const MAX_TERMINAL_TIMEOUT_LONG_RUNNING_MS = 600_000;
/** Audit / History 中保存的命令预览上限（不无限持久化 shell script） */
export const TERMINAL_AUDIT_COMMAND_PREVIEW_MAX = 500;

/** 生产 Tool Error 固定文案（绝不含 bridge message / absolute path） */
const TERMINAL_FIXED_MESSAGES: Record<string, string> = {
  TERMINAL_UNAVAILABLE: "终端仅在桌面版且已开启时可用",
  TERMINAL_NATIVE_WORKSPACE_REQUIRED: "终端需要桌面本地工作区",
  TERMINAL_COMMAND_BLOCKED: "该终端命令需要更高系统权限或使用了当前版本不允许的执行方式。",
  TERMINAL_PERMISSION_DENIED: "终端命令被拒绝",
  TERMINAL_TIMEOUT: "终端命令执行超时",
  TERMINAL_EXECUTION_FAILED: "终端命令执行失败",
  TERMINAL_CANCELLED: "终端命令已取消",
};

function terminalError(code: ComputerError["code"], message: string): never {
  throw new ComputerError(code, message);
}

/** strip ANSI escape sequences（彩色控制字符绝不进入 Chat / Tool Result / Audit） */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\u001B\][^\u0007]*\u0007/g, "");
}

/** Web 第二层 bound（Desktop Runtime 应先 bounded；此处防御） */
export function boundTerminalOutput(text: string, maxChars: number): { text: string; truncated: boolean } {
  const stripped = stripAnsi(text);
  if (stripped.length <= maxChars) return { text: stripped, truncated: false };
  return { text: stripped.slice(0, maxChars), truncated: true };
}

/** 命令预览（≤500 chars；Audit/History/UI 用；secret + absolute path 必须 redacted） */
export function terminalCommandPreview(command: string): string {
  return redactCommandPreview(command, TERMINAL_AUDIT_COMMAND_PREVIEW_MAX);
}

/** Terminal approval fingerprint（shell/rootId/cwd/command 精确绑定；不把完整 command 写入持久化规则） */
export function terminalExecutionFingerprint(input: {
  shell: string;
  rootId: string;
  cwd: string;
  command: string;
}): string {
  return `terminal:${input.shell}:${input.rootId}:${input.cwd}:${input.command}`;
}

function resolveSnapshotWorkspace(snapshot: KiroComputerTurnSnapshot, liveWorkspaces: KiroWorkspaceMeta[]) {
  if (!snapshot.enabled) throw new ComputerError("COMPUTER_DISABLED", "Computer Agent 未启用");
  const ws = liveWorkspaces.find((w) => w.id === snapshot.workspaceId);
  if (!ws) throw new ComputerError("WORKSPACE_NOT_FOUND", "当前 Workspace 不存在");
  return ws;
}

/**
 * 共享安全管线（prepareTerminalExecution）：run/start 共用完全相同的校验。
 * 绝不复制缩水版 pipeline。
 */
function prepareTerminalExecution(params: {
  toolCallId: string;
  toolInput: Record<string, unknown>;
  snapshot: KiroComputerTurnSnapshot;
  liveWorkspaces: KiroWorkspaceMeta[];
  livePermissionRules: ComputerPermissionRule[];
  oneShotApprovals: ComputerOneShotApproval[];
  taskId: string;
  counters: { terminalCount: number };
  schema: typeof runTerminalCommandSchema;
}):
  | {
      kind: "prepared";
      ws: ReturnType<typeof resolveSnapshotWorkspace>;
      root: KiroWorkspaceMeta["roots"][number];
      grantId: string;
      shell: ClassFlowDesktopTerminalShell;
      command: string;
      cwd: string;
      timeoutMs: number;
      isLongRunning: boolean;
      policy: ReturnType<typeof evaluateComputerPolicy>;
      risk: TerminalCommandRisk;
      fingerprint: string;
      askForRisk: boolean;
    }
  | { kind: "approval-required"; request: ReturnType<typeof buildApprovalRequest> }
  | { kind: "error"; output: ComputerToolResult } {
  const { toolCallId, toolInput, snapshot, liveWorkspaces, livePermissionRules, oneShotApprovals, taskId, counters, schema } = params;
  const parsed = schema.safeParse(toolInput);
  if (!parsed.success) {
    return { kind: "error", output: { ok: false, code: "INVALID_INPUT", message: "输入不合法" } };
  }
  const args = parsed.data as Record<string, unknown>;
  if (counters.terminalCount >= COMPUTER_TERMINAL_LIMIT_PER_TURN) {
    return {
      kind: "error",
      output: {
        ok: false,
        code: "PERMISSION_DENIED",
        message: `本轮终端命令已达上限（${COMPUTER_TERMINAL_LIMIT_PER_TURN}/${COMPUTER_TERMINAL_LIMIT_PER_TURN}），请分步进行或开启新对话`,
      },
    };
  }
  const bridge = getClassFlowDesktopTerminalBridge();
  if (!bridge || snapshot.terminalEnabled !== true) {
    return { kind: "error", output: { ok: false, code: "TERMINAL_UNAVAILABLE", message: TERMINAL_FIXED_MESSAGES.TERMINAL_UNAVAILABLE } };
  }
  let ws: ReturnType<typeof resolveSnapshotWorkspace>;
  try {
    ws = resolveSnapshotWorkspace(snapshot, liveWorkspaces);
  } catch (e) {
    const code = e instanceof ComputerError ? e.code : "WORKSPACE_NOT_FOUND";
    return { kind: "error", output: { ok: false, code, message: (e as Error).message } };
  }
  const shell = args.shell as ClassFlowDesktopTerminalShell;
  const command = String(args.command ?? "").trim();
  const rootId = String(args.rootId ?? "");
  const cwdArg = String(args.cwd ?? "").trim();
  const root = rootId ? ws.roots.find((r) => r.id === rootId) : ws.roots.length === 1 ? ws.roots[0] : undefined;
  if (!root) {
    return { kind: "error", output: { ok: false, code: rootId ? "ROOT_NOT_FOUND" : "ROOT_REQUIRED", message: rootId ? "工作区根不存在" : "该工作区有多个根目录，请指定 rootId" } };
  }
  if (!isNativeAdapterRef(root.adapterRef)) {
    return { kind: "error", output: { ok: false, code: "TERMINAL_NATIVE_WORKSPACE_REQUIRED", message: TERMINAL_FIXED_MESSAGES.TERMINAL_NATIVE_WORKSPACE_REQUIRED } };
  }
  const grantId = nativeGrantIdFromAdapterRef(root.adapterRef);
  if (!grantId) {
    return { kind: "error", output: { ok: false, code: "WORKSPACE_PERMISSION_REQUIRED", message: "本地授权信息无效，需要重新授权" } };
  }
  if (root.access === "read-only") {
    return { kind: "error", output: { ok: false, code: "READ_ONLY_ROOT", message: "只读工作区不允许运行终端命令" } };
  }
  let cwd: string;
  try {
    cwd = normalizeRelativeComputerPath(cwdArg, { allowRoot: true }).path;
  } catch {
    return { kind: "error", output: { ok: false, code: "PATH_OUTSIDE_SANDBOX", message: "工作目录超出授权范围" } };
  }
  const policy = evaluateComputerPolicy({
    capability: "shell.execute",
    mode: snapshot.agentMode,
    rules: livePermissionRules,
    workspaceId: ws.id,
    rootId: root.id,
    rootAccess: root.access,
    resourcePath: cwd,
  });
  if (policy.effect === "deny") {
    return { kind: "error", output: { ok: false, code: "PERMISSION_DENIED", message: policy.reason } };
  }
  if (policy.effect === "allow" && policy.matchedRuleId && snapshot.agentMode !== "workspace-auto") {
    (policy as { effect: string }).effect = "ask";
  }
  const risk = classifyTerminalCommandRisk(command, shell);
  if (risk === "blocked") {
    void appendComputerAuditEntry({
      id: `audit-${crypto.randomUUID()}`,
      timestamp: new Date().toISOString(),
      taskId,
      toolCallId,
      toolName: "run_terminal_command",
      capability: "shell.execute",
      decision: "deny",
      outcome: "denied",
      workspaceId: ws.id,
      workspaceLabel: ws.name,
      rootId: root.id,
      rootLabel: root.label,
      relativePath: cwd,
      shell,
      risk,
      commandPreview: terminalCommandPreview(command),
    });
    return { kind: "error", output: { ok: false, code: "TERMINAL_COMMAND_BLOCKED", message: TERMINAL_FIXED_MESSAGES.TERMINAL_COMMAND_BLOCKED } };
  }
  const askForRisk = risk === "destructive" || risk === "privileged";
  const needsApproval = policy.effect === "ask" || askForRisk;
  const fingerprint = terminalExecutionFingerprint({ shell, rootId: root.id, cwd, command });
  if (needsApproval) {
    const matched = oneShotApprovals.findIndex((o) =>
      oneShotApprovalMatches(o, {
        toolCallId,
        capability: "shell.execute",
        workspaceId: ws.id,
        rootId: root.id,
        relativePath: cwd,
        fingerprint,
      })
    );
    if (matched === -1) {
      return {
        kind: "approval-required",
        request: buildApprovalRequest({
          id: `approval-${crypto.randomUUID()}`,
          toolCallId,
          taskId,
          capability: "shell.execute",
          workspaceId: ws.id,
          workspaceLabel: ws.name,
          rootId: root.id,
          rootLabel: root.label,
          relativePath: cwd,
          resourceLabel: terminalCommandPreview(command),
          description:
            risk === "destructive"
              ? `${shell === "powershell" ? "PowerShell" : "命令提示符"}：${terminalCommandPreview(command)}（此命令可能删除或不可逆修改文件。）`
              : risk === "privileged"
                ? `${shell === "powershell" ? "PowerShell" : "命令提示符"}：${terminalCommandPreview(command)}（此命令会启动额外的命令解释器或执行高权限/系统级操作。）`
                : `${shell === "powershell" ? "PowerShell" : "命令提示符"}：${terminalCommandPreview(command)}`,
          fingerprint,
          allowedDecisions: ["deny", "allow-once"],
          commandPreview: terminalCommandPreview(command),
          shell,
          risk: askForRisk ? risk : undefined,
        }),
      };
    }
    oneShotApprovals.splice(matched, 1);
  }
  const isLongRunning = (args.executionMode as string) === "long-running";
  const timeoutMs = isLongRunning
    ? Math.min(Math.max(args.timeoutMs === undefined ? 300_000 : Number(args.timeoutMs), MIN_TERMINAL_TIMEOUT_MS), MAX_TERMINAL_TIMEOUT_LONG_RUNNING_MS)
    : Math.min(Math.max(args.timeoutMs === undefined ? DEFAULT_TERMINAL_TIMEOUT_MS : Number(args.timeoutMs), MIN_TERMINAL_TIMEOUT_MS), MAX_TERMINAL_TIMEOUT_MS);
  return { kind: "prepared", ws, root, grantId, shell, command, cwd, timeoutMs, isLongRunning, policy, risk, fingerprint, askForRisk };
}

/**
 * V1.0.1 Handoff 冻结：Terminal Bridge Error Contract 唯一映射。
 * resolve：exit 0 / nonzero / timeout（timedOut=true）；reject：PERMISSION_DENIED / CANCELLED /
 * EXECUTION_FAILED / INVALID_OPERATION。绝不透传 bridge message；dev console 保持 sanitized。
 */
function terminalBridgeErrorToComputerError(err: unknown): ComputerError {
  const e = err as Partial<DesktopTerminalBridgeError> | null | undefined;
  const code = e?.code;
  const raw = typeof e?.message === "string" ? e.message : "";
  if (raw) {
    // dev-only（sanitize 后；绝不进入 Tool Result / Audit 文案）
    // eslint-disable-next-line no-console
    console.debug("[kiro:terminal] bridge error", raw.replace(/[A-Za-z]:\\[^\s;,)\]]{1,300}/g, "[path]").slice(0, 200));
  }
  switch (code) {
    case "PERMISSION_DENIED":
      return new ComputerError("TERMINAL_PERMISSION_DENIED", TERMINAL_FIXED_MESSAGES.TERMINAL_PERMISSION_DENIED);
    case "CANCELLED":
      return new ComputerError("TERMINAL_CANCELLED", TERMINAL_FIXED_MESSAGES.TERMINAL_CANCELLED);
    case "INVALID_OPERATION":
    case "EXECUTION_FAILED":
    default:
      // 未结构化 / 未知 reject 同样归一化（绝不把原始异常暴露给模型）
      return new ComputerError("TERMINAL_EXECUTION_FAILED", TERMINAL_FIXED_MESSAGES.TERMINAL_EXECUTION_FAILED);
  }
}

/** Active execution registry（runtime-only；Stop 必须终止 process tree） */
const activeExecutions = new Map<string, { cancel: () => Promise<void> }>();

export function registerActiveTerminalExecution(executionId: string, cancel: () => Promise<void>): void {
  activeExecutions.set(executionId, { cancel });
}

export function unregisterActiveTerminalExecution(executionId: string): void {
  activeExecutions.delete(executionId);
}

/** Stop Kiro：终止所有活跃 terminal process tree（bridge.cancel；每个 execution 一次） */
export async function cancelAllActiveTerminalExecutions(): Promise<void> {
  const ids = Array.from(activeExecutions.keys());
  for (const id of ids) {
    const entry = activeExecutions.get(id);
    if (!entry) continue;
    activeExecutions.delete(id);
    try {
      await entry.cancel();
    } catch {
      /* cancel 失败不阻断 */
    }
  }
}

export interface ExecuteKiroTerminalCommandInput {
  toolCallId: string;
  toolInput: Record<string, unknown>;
  snapshot: KiroComputerTurnSnapshot;
  liveWorkspaces: KiroWorkspaceMeta[];
  livePermissionRules: ComputerPermissionRule[];
  counters: { readCount: number; mutationCount: number; terminalCount: number };
  oneShotApprovals: ComputerOneShotApproval[];
  taskId: string;
  /** V2 streaming：启动前注册 runtime activity（UI-only；经 store 消费） */
  onTerminalActivityInit?: (init: TerminalActivityInit) => void;
  /** V2 streaming：sanitized 事件转发（UI runtime activity store；不进入模型 context） */
  onTerminalEvent?: (event: DesktopTerminalEvent) => void;
}

export interface StartKiroTerminalCommandInput extends ExecuteKiroTerminalCommandInput {}
export interface WaitKiroTerminalCommandInput {
  toolCallId: string;
  toolInput: Record<string, unknown>;
  snapshot: KiroComputerTurnSnapshot;
  liveWorkspaces: KiroWorkspaceMeta[];
  livePermissionRules: ComputerPermissionRule[];
  counters: { readCount: number; mutationCount: number; terminalCount: number };
  oneShotApprovals: ComputerOneShotApproval[];
  taskId: string;
}

export async function executeKiroTerminalCommand(
  input: ExecuteKiroTerminalCommandInput
): Promise<ComputerExecutionAttempt> {
  const { toolCallId, toolInput, snapshot, liveWorkspaces, livePermissionRules, counters, oneShotApprovals, taskId } = input;

  const fail = (output: ComputerToolResult): ComputerExecutionAttempt => ({ kind: "completed", output });

  const prepared = prepareTerminalExecution({
    toolCallId,
    toolInput,
    snapshot,
    liveWorkspaces,
    livePermissionRules,
    oneShotApprovals,
    taskId,
    counters,
    schema: runTerminalCommandSchema,
  });
  if (prepared.kind === "error") return fail(prepared.output);
  if (prepared.kind === "approval-required") return { kind: "approval-required", request: prepared.request };
  const { ws, root, grantId, shell, command, cwd, timeoutMs, isLongRunning, policy, risk, askForRisk } = prepared;

  // ---- execute ----
  counters.terminalCount += 1;
  const executionId = `term-${crypto.randomUUID()}`;
  const bridge = getClassFlowDesktopTerminalBridge()!;
  const bridgeV2 = getClassFlowDesktopTerminalBridgeV2();
  let outcome: { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; durationMs: number; stdoutTruncated: boolean; stderrTruncated: boolean };
  try {
    // V2 streaming：启动前注册 runtime activity（UI 立即进入 starting/running；事件经 streamSink 推送）
    input.onTerminalActivityInit?.({
      executionId,
      toolCallId,
      shell,
      commandPreview: terminalCommandPreview(command),
    });
    registerActiveTerminalExecution(executionId, () => bridge.cancel({ executionId }));
    try {
      if (bridgeV2) {
        const unsubscribe = bridgeV2.subscribe((event) => {
          if (event.executionId !== executionId) return;
          input.onTerminalEvent?.(event);
        });
        try {
          outcome = await bridgeV2.start({
            executionId,
            shell,
            grantId,
            cwd,
            command,
            timeoutMs,
            executionMode: isLongRunning ? "long-running" : "foreground",
          });
        } finally {
          unsubscribe();
        }
      } else {
        outcome = await bridge.execute({
          executionId,
          shell,
          grantId,
          cwd,
          command,
          timeoutMs,
        });
      }
    } finally {
      unregisterActiveTerminalExecution(executionId);
    }
  } catch (err) {
    const mapped = terminalBridgeErrorToComputerError(err);
    return fail({ ok: false, code: mapped.code, message: mapped.message });
  }

  // ---- output bounds（Web 第二层）+ 完整 sanitization（ANSI → path → secret → bound，与 streaming 同规则）----
  const stdout = sanitizeTerminalModelOutput(outcome.stdout, MAX_TERMINAL_STDOUT_CHARS);
  const stderr = sanitizeTerminalModelOutput(outcome.stderr, MAX_TERMINAL_STDERR_CHARS);
  const truncated = outcome.stdoutTruncated || outcome.stderrTruncated || stdout.truncated || stderr.truncated;

  // ---- audit（命令预览 ≤500；不含 grantId / absolute path / 完整 stdout/stderr）----
  void appendComputerAuditEntry({
    id: `audit-${crypto.randomUUID()}`,
    timestamp: new Date().toISOString(),
    taskId,
    toolCallId,
    toolName: "run_terminal_command",
    capability: "shell.execute",
    decision: policy.effect === "ask" || askForRisk ? "allow-once" : "auto",
    outcome: "executed",
    workspaceId: ws.id,
    workspaceLabel: ws.name,
    rootId: root.id,
    rootLabel: root.label,
    relativePath: cwd,
    shell,
    risk: askForRisk ? risk : "normal",
    commandPreview: terminalCommandPreview(command),
    exitCode: outcome.exitCode ?? undefined,
    durationMs: outcome.durationMs,
    timedOut: outcome.timedOut,
  });

  // ---- knowledge dirty（保守：成功命令可能改变 workspace 文件；下次搜索重新 refresh）----
  void markWorkspaceKnowledgeDirty(ws.id).catch(() => {});

  // ---- result：结构化事实（无 PID / absolute cwd / grantId / environment）----
  return {
    kind: "completed",
    output: {
      ok: true,
      data: {
        shell,
        cwd,
        exitCode: outcome.exitCode,
        stdout: stdout.text,
        stderr: stderr.text,
        timedOut: outcome.timedOut,
        durationMs: outcome.durationMs,
        truncated,
      },
    },
  };
}

/**
 * Terminal V2（Phase 3 async）：start_terminal_command —— 异步启动交互式命令，立即返回 handle。
 * 与 run_terminal_command 共享完全相同的 safety pipeline（prepareTerminalExecution）。
 */
export async function startKiroTerminalCommand(
  input: StartKiroTerminalCommandInput
): Promise<ComputerExecutionAttempt> {
  const { toolCallId, toolInput, snapshot, liveWorkspaces, livePermissionRules, counters, oneShotApprovals, taskId } = input;
  const fail = (output: ComputerToolResult): ComputerExecutionAttempt => ({ kind: "completed", output });
  const prepared = prepareTerminalExecution({
    toolCallId,
    toolInput,
    snapshot,
    liveWorkspaces,
    livePermissionRules,
    oneShotApprovals,
    taskId,
    counters,
    schema: startTerminalCommandSchema,
  });
  if (prepared.kind === "error") return fail(prepared.output);
  if (prepared.kind === "approval-required") return { kind: "approval-required", request: prepared.request };
  const { ws, root, grantId, shell, command, cwd, timeoutMs, isLongRunning, policy, risk, askForRisk } = prepared;
  counters.terminalCount += 1;
  const executionId = `term-${crypto.randomUUID()}`;
  const bridge = getClassFlowDesktopTerminalBridge();
  const bridgeV2 = getClassFlowDesktopTerminalBridgeV2();
  if (!bridgeV2 || !bridge) {
    return fail({ ok: false, code: "TERMINAL_UNAVAILABLE", message: TERMINAL_FIXED_MESSAGES.TERMINAL_UNAVAILABLE });
  }
  const handle = createInteractiveHandle(executionId, toolCallId, shell, terminalCommandPreview(command));
  // 立即注册 activity（UI 进入 running）
  input.onTerminalActivityInit?.({ executionId, toolCallId, shell, commandPreview: terminalCommandPreview(command) });
  registerActiveTerminalExecution(executionId, () => bridge.cancel({ executionId }));
  // 后台启动：复用与 run 相同的 bridge 调用，但不等待完成即可返回 handle
  const backgroundPromise = (async () => {
    const unsubscribe = bridgeV2.subscribe((event) => {
      if (event.executionId !== executionId) return;
      input.onTerminalEvent?.(event);
    });
    try {
      const outcome = await bridgeV2.start({
        executionId,
        shell,
        grantId,
        cwd,
        command,
        timeoutMs,
        executionMode: isLongRunning ? "long-running" : "foreground",
      });
      const stdout = sanitizeTerminalModelOutput(outcome.stdout, MAX_TERMINAL_STDOUT_CHARS);
      const stderr = sanitizeTerminalModelOutput(outcome.stderr, MAX_TERMINAL_STDERR_CHARS);
      const truncated = outcome.stdoutTruncated || outcome.stderrTruncated || stdout.truncated || stderr.truncated;
      const status: import("@/lib/ai/computer/terminal/interactiveRegistry").InteractiveFinalResult["status"] = outcome.timedOut
        ? "timed-out"
        : outcome.exitCode === 0
          ? "completed"
          : "failed";
      const finalResult = {
        status,
        exitCode: outcome.exitCode,
        stdout: stdout.text,
        stderr: stderr.text,
        durationMs: outcome.durationMs,
        truncated,
        timedOut: outcome.timedOut,
      };
      resolveInteractiveHandle(handle, finalResult);
      return finalResult;
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "CANCELLED") {
        const cancelledResult = {
          status: "cancelled" as const,
          exitCode: null,
          stdout: "",
          stderr: "",
          durationMs: Date.now() - Date.now(),
          truncated: false,
          timedOut: false,
        };
        // 尝试从 record 获取 startedAt 精确 duration？简化
        const rec = getInteractiveRecord(handle);
        if (rec) {
          cancelledResult.durationMs = Date.now() - rec.startedAt;
        }
        resolveInteractiveHandle(handle, cancelledResult);
        // 不再向上抛，让 wait 能拿到 cancelled 结果
        return cancelledResult;
      }
      rejectInteractiveHandle(handle, err as Error);
      throw err;
    } finally {
      unsubscribe();
      unregisterActiveTerminalExecution(executionId);
    }
  })();
  // 将后台 promise 注册到 interactiveRegistry 供 wait 使用
  setInteractivePromise(handle, backgroundPromise as Promise<import("@/lib/ai/computer/terminal/interactiveRegistry").InteractiveFinalResult>);
  // audit（启动时记录，不含 stdout）
  void appendComputerAuditEntry({
    id: `audit-${crypto.randomUUID()}`,
    timestamp: new Date().toISOString(),
    taskId,
    toolCallId,
    toolName: "start_terminal_command",
    capability: "shell.execute",
    decision: policy.effect === "ask" || askForRisk ? "allow-once" : "auto",
    outcome: "executed",
    workspaceId: ws.id,
    workspaceLabel: ws.name,
    rootId: root.id,
    rootLabel: root.label,
    relativePath: cwd,
    shell,
    risk: askForRisk ? risk : "normal",
    commandPreview: terminalCommandPreview(command),
  });
  void markWorkspaceKnowledgeDirty(ws.id).catch(() => {});
  return {
    kind: "completed",
    output: {
      ok: true,
      data: {
        started: true,
        terminalHandle: handle,
        shell,
        cwd,
        status: "running",
      },
    },
  };
}

/**
 * Terminal V2（Phase 3 async）：wait_terminal_command —— 等待 handle 对应的命令完成。
 * 仅接受 opaque handle，不接受 executionId/PID。handle 终态后保留短 TTL，随后自动清理。
 */
export async function waitKiroTerminalCommand(
  input: WaitKiroTerminalCommandInput
): Promise<ComputerExecutionAttempt> {
  const { toolInput } = input;
  const fail = (output: ComputerToolResult): ComputerExecutionAttempt => ({ kind: "completed", output });
  const parsed = waitTerminalCommandSchema.safeParse(toolInput);
  if (!parsed.success) {
    return fail({ ok: false, code: "INVALID_INPUT", message: "输入不合法" });
  }
  const { handle, timeoutMs } = parsed.data;
  const record = getInteractiveRecord(handle);
  if (!record) {
    return fail({ ok: false, code: "TERMINAL_NOT_FOUND", message: "终端进程不存在或已结束。" });
  }
  const waitTimeout = timeoutMs ?? 120000;
  let final: import("@/lib/ai/computer/terminal/interactiveRegistry").InteractiveFinalResult;
  try {
    // 等待结果，带超时
    final = await Promise.race([
      record.resultPromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("WAIT_TIMEOUT")), waitTimeout)),
    ]);
  } catch (err) {
    if ((err as Error).message === "WAIT_TIMEOUT") {
      return fail({ ok: false, code: "TERMINAL_TIMEOUT", message: TERMINAL_FIXED_MESSAGES.TERMINAL_TIMEOUT });
    }
    const mapped = terminalBridgeErrorToComputerError(err);
    return fail({ ok: false, code: mapped.code, message: mapped.message });
  }
  // 成功等待后删除 handle（TTL 已在 registry 中调度，但 wait 成功立即清理）
  deleteInteractiveHandle(handle);
  return {
    kind: "completed",
    output: {
      ok: true,
      data: {
        status: final.status,
        exitCode: final.exitCode,
        stdout: final.stdout,
        stderr: final.stderr,
        durationMs: final.durationMs,
        truncated: final.truncated,
        timedOut: final.timedOut,
      },
    },
  };
}

/** 敏感输入形状检测：任何会被 redactTerminalSecrets 命中的输入都禁止经模型路径 */
export function isSensitiveTerminalInput(data: string): boolean {
  const cleaned = redactTerminalSecrets(data);
  return cleaned !== data;
}

export interface WriteKiroTerminalInputInput {
  toolCallId: string;
  toolInput: Record<string, unknown>;
  snapshot: KiroComputerTurnSnapshot;
  liveWorkspaces: KiroWorkspaceMeta[];
  livePermissionRules: ComputerPermissionRule[];
  counters: { readCount: number; mutationCount: number; terminalCount: number };
  oneShotApprovals: ComputerOneShotApproval[];
  taskId: string;
}

/**
 * Terminal V2（Phase 3）：write_terminal_input —— 向活跃进程写非敏感 stdin。
 * - 只允许非敏感输入（y/n/数字/短文本）；敏感输入必须走 UI secure-input（不经模型 context）。
 * - handle 是 opaque logical handle（非原生 executionId）；进程结束后拒绝。
 * - 不消耗 terminalCount（不启动新进程）。
 */
export async function writeKiroTerminalInput(
  input: WriteKiroTerminalInputInput
): Promise<ComputerExecutionAttempt> {
  const { toolInput, snapshot, liveWorkspaces } = input;
  const fail = (output: ComputerToolResult): ComputerExecutionAttempt => ({ kind: "completed", output });

  const parsed = writeTerminalInputSchema.safeParse(toolInput);
  if (!parsed.success) {
    return fail({ ok: false, code: "INVALID_INPUT", message: "输入不合法" });
  }
  const { handle, data } = parsed.data;

  // 终端 gate
  const bridgeV2 = getClassFlowDesktopTerminalBridgeV2();
  if (!bridgeV2 || snapshot.terminalEnabled !== true) {
    return fail({ ok: false, code: "TERMINAL_UNAVAILABLE", message: TERMINAL_FIXED_MESSAGES.TERMINAL_UNAVAILABLE });
  }

  const executionId = getInteractiveRecord(handle)?.executionId;
  if (!executionId) {
    return fail({ ok: false, code: "TERMINAL_NOT_FOUND", message: "终端进程不存在或已结束。" });
  }

  // 敏感输入硬边界：password / API Key / Token / SSH secret 绝不进入模型路径
  if (isSensitiveTerminalInput(data)) {
    return fail({
      ok: false,
      code: "TERMINAL_SENSITIVE_INPUT_REJECTED",
      message: "检测到疑似敏感信息（密码 / API Key / Token 等）。敏感输入请让用户通过界面安全输入框手动输入，不要通过模型工具发送。",
    });
  }

  try {
    await bridgeV2.write({ executionId, data });
  } catch (err) {
    const mapped = terminalBridgeErrorToComputerError(err);
    return fail({ ok: false, code: mapped.code, message: mapped.message });
  }

  // audit：记录 handle 与大小，绝不记录 data 内容
  void appendComputerAuditEntry({
    id: `audit-${crypto.randomUUID()}`,
    timestamp: new Date().toISOString(),
    taskId: input.taskId,
    toolCallId: input.toolCallId,
    toolName: "write_terminal_input",
    capability: "shell.execute",
    decision: "auto",
    outcome: "executed",
    workspaceId: snapshot.workspaceId ?? "",
    workspaceLabel: "",
    rootId: "",
    rootLabel: "",
    relativePath: "",
    commandPreview: `stdin write (handle=${handle}, size=${data.length})`,
  });

  return {
    kind: "completed",
    output: { ok: true, data: { written: true, size: data.length } },
  };
}

export type { TerminalCommandRisk };
