/**
 * PTY Agent Integration（Phase 4）— 高层工具，不暴露 arbitrary keys。
 *
 * - create_terminal_session / run_terminal_session_command / write_terminal_session_input / close_terminal_session
 * - 每条 run 命令重新经过 shell.execute policy + Risk Gate + approval（绑定原始 session 的 workspace/root/shell）
 * - 使用随机 sentinel 探测命令结束（PowerShell $LASTEXITCODE），不暴露内部实现给模型
 * - 每 session 同时最多一条活跃 Agent 命令
 * - 输出经脱敏（ANSI → path → secret → bound）
 * - 本轮 PTY Agent 仅支持 PowerShell（cmd PTY 返回 UNSUPPORTED_TERMINAL_SHELL）
 */

import { KiroWorkspaceMeta, ComputerPermissionRule } from "@/lib/ai/computer/types";
import { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import { ComputerError } from "@/lib/ai/computer/errors";
import { ComputerExecutionAttempt, ComputerToolResult } from "@/lib/ai/computer/result";
import { ComputerOneShotApproval, buildApprovalRequest, oneShotApprovalMatches } from "@/lib/ai/computer/approval";
import { evaluateComputerPolicy } from "@/lib/ai/computer/policy";
import { normalizeRelativeComputerPath } from "@/lib/ai/computer/workspace/resolver";
import { getClassFlowDesktopTerminalPtyBridge } from "@/lib/desktop/bridge";
import { isNativeAdapterRef, nativeGrantIdFromAdapterRef } from "@/lib/desktop/bridge";
import { DesktopTerminalSessionEvent } from "@/lib/desktop/types";
import { classifyTerminalCommandRisk } from "@/lib/ai/computer/terminal/risk";
import { redactCommandPreview, sanitizeTerminalModelOutput } from "@/lib/ai/computer/terminal/redact";
import { appendComputerAuditEntry } from "@/lib/ai/computer/audit";
import { terminalExecutionFingerprint } from "@/lib/ai/computer/terminal/executor";
import {
  createTerminalSessionSchema,
  runTerminalSessionCommandSchema,
  writeTerminalSessionInputSchema,
  closeTerminalSessionSchema,
} from "@/lib/ai/computer/tools/schemas";

const TERMINAL_FIXED_MESSAGES = {
  TERMINAL_UNAVAILABLE: "终端仅在桌面版且已开启时可用",
  TERMINAL_NATIVE_WORKSPACE_REQUIRED: "终端需要桌面本地工作区",
  TERMINAL_NOT_FOUND: "终端会话不存在或已结束。",
  TERMINAL_SESSION_EXITED: "终端会话已结束。",
};

function resolveSnapshotWorkspace(snapshot: KiroComputerTurnSnapshot, liveWorkspaces: KiroWorkspaceMeta[]) {
  if (!snapshot.enabled) throw new ComputerError("COMPUTER_DISABLED", "Computer Agent 未启用");
  const ws = liveWorkspaces.find((w) => w.id === snapshot.workspaceId);
  if (!ws) throw new ComputerError("WORKSPACE_NOT_FOUND", "当前 Workspace 不存在");
  return ws;
}

interface PtyAgentSessionRecord {
  handle: string;
  sessionId: string;
  workspaceId: string;
  rootId: string;
  shell: "powershell";
  initialCwd: string;
  createdAt: number;
}

const ptySessions = new Map<string, PtyAgentSessionRecord>(); // handle -> record
const sessionIdToHandle = new Map<string, string>(); // sessionId -> handle
// 每 session 的活跃命令状态（同时仅一条）
const activePtyCommands = new Map<string, { nonce: string; resolve: (r: PtyCommandResult) => void; reject: (e: Error) => void; buffer: string; timer?: ReturnType<typeof setTimeout> }>();

interface PtyCommandResult {
  exitCode: number | null;
  output: string;
  truncated: boolean;
}

function ptyError(code: string, message: string): ComputerError {
  return new ComputerError(code as ComputerError["code"], message);
}

// 供测试：直接检查 handle 存在
export function hasPtyHandle(handle: string): boolean {
  return ptySessions.has(handle);
}
export function activePtyHandleCount(): number {
  return ptySessions.size;
}
export function clearAllPtyHandles(): void {
  ptySessions.clear();
  sessionIdToHandle.clear();
  for (const [, rec] of activePtyCommands) {
    if (rec.timer) clearTimeout(rec.timer);
  }
  activePtyCommands.clear();
  if (ptyGlobalUnsubscribe) {
    try { ptyGlobalUnsubscribe(); } catch {}
    ptyGlobalUnsubscribe = null;
    ptyGlobalBridge = null;
  }
}
export function getPtySessionRecord(handle: string): PtyAgentSessionRecord | undefined {
  return ptySessions.get(handle);
}

// 订阅 PTY session 事件：全局单例订阅，路由到对应 active command 的 buffer + 处理 exit 清理
let ptyGlobalUnsubscribe: (() => void) | null = null;
let ptyGlobalBridge: unknown = null;
function ensurePtyEventSubscription(): void {
  const bridge = getClassFlowDesktopTerminalPtyBridge();
  if (!bridge || !bridge.subscribeSession) return;
  if (ptyGlobalUnsubscribe && ptyGlobalBridge === bridge) return;
  if (ptyGlobalUnsubscribe) {
    try { ptyGlobalUnsubscribe(); } catch {}
    ptyGlobalUnsubscribe = null;
  }
  ptyGlobalBridge = bridge;
  ptyGlobalUnsubscribe = bridge.subscribeSession((event: unknown) => {
    const e = event as DesktopTerminalSessionEvent;
    if (e.type === "exit") {
      const handle = sessionIdToHandle.get(e.sessionId);
      if (handle) {
        // 清理 active command（若有）
        const rec = activePtyCommands.get(e.sessionId);
        if (rec) {
          if (rec.timer) clearTimeout(rec.timer);
          activePtyCommands.delete(e.sessionId);
          rec.reject(new Error("PTY_SESSION_EXITED"));
        }
        ptySessions.delete(handle);
        sessionIdToHandle.delete(e.sessionId);
      }
      return;
    }
    if (e.type !== "data") return;
    for (const [sessionId, rec] of activePtyCommands.entries()) {
      if (sessionId !== (e as { sessionId: string }).sessionId) continue;
      rec.buffer += (e as { data: string }).data;
      const sentinel = `__CF_DONE_${rec.nonce}__`;
      const idx = rec.buffer.indexOf(sentinel);
      if (idx !== -1) {
        const before = rec.buffer.slice(0, idx);
        const after = rec.buffer.slice(idx + sentinel.length);
        const m = after.match(/^(\d+)/);
        const exitCode = m ? parseInt(m[1], 10) : null;
        const output = before.trim();
        if (rec.timer) clearTimeout(rec.timer);
        activePtyCommands.delete(sessionId);
        rec.resolve({ exitCode, output, truncated: false });
        break;
      }
    }
  });
}

export interface CreatePtySessionInput {
  toolCallId: string;
  toolInput: Record<string, unknown>;
  snapshot: KiroComputerTurnSnapshot;
  liveWorkspaces: KiroWorkspaceMeta[];
  livePermissionRules: ComputerPermissionRule[];
  counters: { readCount: number; mutationCount: number; terminalCount: number };
  oneShotApprovals: ComputerOneShotApproval[];
  taskId: string;
}

export async function createKiroPtySession(input: CreatePtySessionInput): Promise<ComputerExecutionAttempt> {
  const { toolCallId, toolInput, snapshot, liveWorkspaces, livePermissionRules } = input;
  const fail = (output: ComputerToolResult): ComputerExecutionAttempt => ({ kind: "completed", output });
  const parsed = createTerminalSessionSchema.safeParse(toolInput);
  if (!parsed.success) return fail({ ok: false, code: "INVALID_INPUT", message: "输入不合法" });
  const args = parsed.data;
  // 本轮 PTY Agent 仅支持 PowerShell
  if (args.shell !== "powershell") {
    return fail({ ok: false, code: "UNSUPPORTED_TERMINAL_SHELL", message: "当前 PTY 仅支持 PowerShell" });
  }
  const bridge = getClassFlowDesktopTerminalPtyBridge();
  if (!bridge || snapshot.terminalEnabled !== true) {
    return fail({ ok: false, code: "TERMINAL_UNAVAILABLE", message: TERMINAL_FIXED_MESSAGES.TERMINAL_UNAVAILABLE });
  }
  let ws: ReturnType<typeof resolveSnapshotWorkspace>;
  try {
    ws = resolveSnapshotWorkspace(snapshot, liveWorkspaces);
  } catch (e) {
    return fail({ ok: false, code: (e as ComputerError).code, message: (e as Error).message });
  }
  const shell = args.shell as "powershell";
  const rootId = args.rootId ? String(args.rootId) : "";
  const cwdArg = args.cwd ? String(args.cwd) : "";
  const root = rootId ? ws.roots.find((r) => r.id === rootId) : ws.roots.length === 1 ? ws.roots[0] : undefined;
  if (!root) return fail({ ok: false, code: rootId ? "ROOT_NOT_FOUND" : "ROOT_REQUIRED", message: rootId ? "工作区根不存在" : "该工作区有多个根目录，请指定 rootId" });
  if (!isNativeAdapterRef(root.adapterRef)) return fail({ ok: false, code: "TERMINAL_NATIVE_WORKSPACE_REQUIRED", message: TERMINAL_FIXED_MESSAGES.TERMINAL_NATIVE_WORKSPACE_REQUIRED });
  const grantId = nativeGrantIdFromAdapterRef(root.adapterRef);
  if (!grantId) return fail({ ok: false, code: "WORKSPACE_PERMISSION_REQUIRED", message: "本地授权信息无效，需要重新授权" });
  if (root.access === "read-only") return fail({ ok: false, code: "READ_ONLY_ROOT", message: "只读工作区不允许创建终端会话" });
  let cwd: string;
  try {
    cwd = normalizeRelativeComputerPath(cwdArg, { allowRoot: true }).path;
  } catch {
    return fail({ ok: false, code: "PATH_OUTSIDE_SANDBOX", message: "工作目录超出授权范围" });
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
  if (policy.effect === "deny") return fail({ ok: false, code: "PERMISSION_DENIED", message: policy.reason });
  if (policy.effect === "allow" && policy.matchedRuleId && snapshot.agentMode !== "workspace-auto") {
    (policy as { effect: string }).effect = "ask";
  }
  if (policy.effect === "ask") {
    const fingerprint = `pty-create:${root.id}:${cwd}:${shell}`;
    const matched = input.oneShotApprovals.findIndex((o) => oneShotApprovalMatches(o, { toolCallId, capability: "shell.execute", workspaceId: ws.id, rootId: root.id, relativePath: cwd, fingerprint }));
    if (matched === -1) {
      return {
        kind: "approval-required",
        request: buildApprovalRequest({
          id: `approval-${crypto.randomUUID()}`,
          toolCallId,
          taskId: input.taskId,
          capability: "shell.execute",
          workspaceId: ws.id,
          workspaceLabel: ws.name,
          rootId: root.id,
          rootLabel: root.label,
          relativePath: cwd,
          resourceLabel: `创建 ${shell} 会话`,
          description: `${shell === "powershell" ? "PowerShell" : "命令提示符"} 持久会话：${cwd || "/"}`,
          fingerprint,
          allowedDecisions: ["deny", "allow-once"],
          commandPreview: `create ${shell} session`,
          shell,
        }),
      };
    }
    input.oneShotApprovals.splice(matched, 1);
  }
  try {
    const result = await bridge.createSession!({ shell, grantId, cwd, cols: 120, rows: 32 });
    const sessionId = result.sessionId;
    const handle = `sh-${crypto.randomUUID().slice(0, 8)}`;
    const record: PtyAgentSessionRecord = {
      handle,
      sessionId,
      workspaceId: ws.id,
      rootId: root.id,
      shell,
      initialCwd: cwd,
      createdAt: Date.now(),
    };
    ptySessions.set(handle, record);
    sessionIdToHandle.set(sessionId, handle);
    ensurePtyEventSubscription();
    void appendComputerAuditEntry({
      id: `audit-${crypto.randomUUID()}`,
      timestamp: new Date().toISOString(),
      taskId: input.taskId,
      toolCallId,
      toolName: "create_terminal_session",
      capability: "shell.execute",
      decision: policy.effect === "ask" ? "allow-once" : "auto",
      outcome: "executed",
      workspaceId: ws.id,
      workspaceLabel: ws.name,
      rootId: root.id,
      rootLabel: root.label,
      relativePath: cwd,
      shell,
      commandPreview: `create ${shell} session`,
    });
    return { kind: "completed", output: { ok: true, data: { sessionHandle: handle, shell, cwd } } };
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "PERMISSION_DENIED") return fail({ ok: false, code: "PERMISSION_DENIED", message: "终端会话被拒绝" });
    return fail({ ok: false, code: "TERMINAL_EXECUTION_FAILED", message: "终端会话创建失败" });
  }
}

export interface RunPtySessionCommandInput extends CreatePtySessionInput {
  // toolInput 包含 sessionHandle, command, timeoutMs
}

export async function runKiroPtySessionCommand(input: RunPtySessionCommandInput): Promise<ComputerExecutionAttempt> {
  const { toolCallId, toolInput, snapshot, liveWorkspaces, livePermissionRules, taskId } = input;
  const fail = (output: ComputerToolResult): ComputerExecutionAttempt => ({ kind: "completed", output });
  const parsed = runTerminalSessionCommandSchema.safeParse(toolInput);
  if (!parsed.success) return fail({ ok: false, code: "INVALID_INPUT", message: "输入不合法" });
  const { sessionHandle, command, timeoutMs } = parsed.data;
  const record = ptySessions.get(sessionHandle);
  if (!record) return fail({ ok: false, code: "TERMINAL_NOT_FOUND", message: TERMINAL_FIXED_MESSAGES.TERMINAL_NOT_FOUND });
  // 验证 session 仍属于当前 workspace 且 root 仍有效
  if (record.workspaceId !== snapshot.workspaceId) {
    return fail({ ok: false, code: "TERMINAL_NOT_FOUND", message: TERMINAL_FIXED_MESSAGES.TERMINAL_NOT_FOUND });
  }
  let ws: ReturnType<typeof resolveSnapshotWorkspace>;
  try {
    ws = resolveSnapshotWorkspace(snapshot, liveWorkspaces);
  } catch (e) {
    return fail({ ok: false, code: (e as ComputerError).code, message: (e as Error).message });
  }
  const root = ws.roots.find((r) => r.id === record.rootId);
  if (!root) return fail({ ok: false, code: "TERMINAL_NOT_FOUND", message: TERMINAL_FIXED_MESSAGES.TERMINAL_NOT_FOUND });
  if (!isNativeAdapterRef(root.adapterRef) || root.access === "read-only" || snapshot.terminalEnabled !== true) {
    return fail({ ok: false, code: "TERMINAL_NOT_FOUND", message: TERMINAL_FIXED_MESSAGES.TERMINAL_NOT_FOUND });
  }
  if (activePtyCommands.has(record.sessionId)) return fail({ ok: false, code: "INVALID_OPERATION", message: "会话已有活跃命令，请等待完成" });
  const policy = evaluateComputerPolicy({
    capability: "shell.execute",
    mode: snapshot.agentMode,
    rules: livePermissionRules,
    workspaceId: ws.id,
    rootId: root.id,
    rootAccess: root.access,
    resourcePath: record.initialCwd,
  });
  if (policy.effect === "deny") return fail({ ok: false, code: "PERMISSION_DENIED", message: policy.reason });
  if (policy.effect === "allow" && policy.matchedRuleId && snapshot.agentMode !== "workspace-auto") {
    (policy as { effect: string }).effect = "ask";
  }
  const shell = record.shell;
  const risk = classifyTerminalCommandRisk(command, shell);
  if (risk === "blocked") {
    return fail({ ok: false, code: "TERMINAL_COMMAND_BLOCKED", message: "该终端命令需要更高系统权限或使用了当前版本不允许的执行方式。" });
  }
  const askForRisk = risk === "destructive" || risk === "privileged";
  if (policy.effect === "ask" || askForRisk) {
    const fingerprint = terminalExecutionFingerprint({ shell, rootId: root.id, cwd: record.initialCwd, command });
    const matched = input.oneShotApprovals.findIndex((o) => oneShotApprovalMatches(o, { toolCallId, capability: "shell.execute", workspaceId: ws.id, rootId: root.id, relativePath: record.initialCwd, fingerprint }));
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
          relativePath: record.initialCwd,
          resourceLabel: redactCommandPreview(command, 80),
          description: `${shell}: ${redactCommandPreview(command, 80)}`,
          fingerprint,
          allowedDecisions: ["deny", "allow-once"],
          commandPreview: redactCommandPreview(command, 80),
          shell,
          risk: askForRisk ? risk : undefined,
        }),
      };
    }
    input.oneShotApprovals.splice(matched, 1);
  }
  const bridge = getClassFlowDesktopTerminalPtyBridge();
  if (!bridge || !bridge.writeSession) return fail({ ok: false, code: "TERMINAL_UNAVAILABLE", message: TERMINAL_FIXED_MESSAGES.TERMINAL_UNAVAILABLE });
  ensurePtyEventSubscription();
  const nonce = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const sentinel = `__CF_DONE_${nonce}__`;
  const wrapped = `${command}\n$__cfExit=$LASTEXITCODE\nWrite-Output "${sentinel}$__cfExit"`;
  let resolve!: (r: PtyCommandResult) => void;
  let reject!: (e: Error) => void;
  const resultPromise = new Promise<PtyCommandResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const timeout = timeoutMs ?? 10000;
  const timer = setTimeout(async () => {
    activePtyCommands.delete(record.sessionId);
    // 超时必须终止整个 session（确定性安全策略）
    try {
      if (bridge.closeSession) await bridge.closeSession({ sessionId: record.sessionId });
    } catch {}
    ptySessions.delete(sessionHandle);
    sessionIdToHandle.delete(record.sessionId);
    reject(new Error("PTY_TIMEOUT"));
  }, timeout);
  activePtyCommands.set(record.sessionId, { nonce, resolve, reject, buffer: "", timer });
  try {
    await bridge.writeSession({ sessionId: record.sessionId, data: wrapped + "\r" });
  } catch (err) {
    activePtyCommands.delete(record.sessionId);
    clearTimeout(timer);
    return fail({ ok: false, code: "TERMINAL_EXECUTION_FAILED", message: "PTY 命令写入失败" });
  }
  let result: PtyCommandResult;
  try {
    result = await resultPromise;
  } catch (e) {
    if ((e as Error).message === "PTY_TIMEOUT") {
      return fail({ ok: false, code: "TERMINAL_TIMEOUT", message: "终端命令执行超时" });
    }
    if ((e as Error).message === "PTY_SESSION_EXITED") {
      return fail({ ok: false, code: "TERMINAL_SESSION_EXITED", message: TERMINAL_FIXED_MESSAGES.TERMINAL_SESSION_EXITED });
    }
    return fail({ ok: false, code: "TERMINAL_EXECUTION_FAILED", message: "PTY 命令执行失败" });
  } finally {
    clearTimeout(timer);
  }
  const sanitized = sanitizeTerminalModelOutput(result.output, 32000);
  void appendComputerAuditEntry({
    id: `audit-${crypto.randomUUID()}`,
    timestamp: new Date().toISOString(),
    taskId,
    toolCallId,
    toolName: "run_terminal_session_command",
    capability: "shell.execute",
    decision: policy.effect === "ask" || askForRisk ? "allow-once" : "auto",
    outcome: "executed",
    workspaceId: ws.id,
    workspaceLabel: ws.name,
    rootId: root.id,
    rootLabel: root.label,
    relativePath: record.initialCwd,
    shell,
    risk: askForRisk ? risk : "normal",
    commandPreview: redactCommandPreview(command, 80),
    exitCode: result.exitCode ?? undefined,
  });
  return {
    kind: "completed",
    output: {
      ok: true,
      data: {
        exitCode: result.exitCode,
        output: sanitized.text,
        truncated: sanitized.truncated || result.truncated,
      },
    },
  };
}

export interface WritePtySessionInputInput extends CreatePtySessionInput {
  // toolInput 包含 sessionHandle, data
}

export async function writeKiroPtySessionInput(input: WritePtySessionInputInput): Promise<ComputerExecutionAttempt> {
  const { toolInput, snapshot } = input;
  const fail = (output: ComputerToolResult): ComputerExecutionAttempt => ({ kind: "completed", output });
  const parsed = writeTerminalSessionInputSchema.safeParse(toolInput);
  if (!parsed.success) return fail({ ok: false, code: "INVALID_INPUT", message: "输入不合法" });
  const { sessionHandle, data } = parsed.data;
  const record = ptySessions.get(sessionHandle);
  if (!record) return fail({ ok: false, code: "TERMINAL_NOT_FOUND", message: TERMINAL_FIXED_MESSAGES.TERMINAL_NOT_FOUND });
  if (record.workspaceId !== snapshot.workspaceId) return fail({ ok: false, code: "TERMINAL_NOT_FOUND", message: TERMINAL_FIXED_MESSAGES.TERMINAL_NOT_FOUND });
  const bridge = getClassFlowDesktopTerminalPtyBridge();
  if (!bridge || !bridge.writeSession) return fail({ ok: false, code: "TERMINAL_UNAVAILABLE", message: TERMINAL_FIXED_MESSAGES.TERMINAL_UNAVAILABLE });
  const { redactTerminalSecrets } = await import("@/lib/ai/computer/terminal/redact");
  if (redactTerminalSecrets(data) !== data) {
    return fail({ ok: false, code: "TERMINAL_SENSITIVE_INPUT_REJECTED", message: "检测到疑似敏感信息，请通过界面安全输入。" });
  }
  try {
    await bridge.writeSession({ sessionId: record.sessionId, data });
  } catch {
    return fail({ ok: false, code: "TERMINAL_EXECUTION_FAILED", message: "PTY 输入失败" });
  }
  return { kind: "completed", output: { ok: true, data: { written: true } } };
}

export interface ClosePtySessionInput extends CreatePtySessionInput {}

export async function closeKiroPtySession(input: ClosePtySessionInput): Promise<ComputerExecutionAttempt> {
  const { toolInput } = input;
  const fail = (output: ComputerToolResult): ComputerExecutionAttempt => ({ kind: "completed", output });
  const parsed = closeTerminalSessionSchema.safeParse(toolInput);
  if (!parsed.success) return fail({ ok: false, code: "INVALID_INPUT", message: "输入不合法" });
  const { sessionHandle } = parsed.data;
  const record = ptySessions.get(sessionHandle);
  if (!record) {
    // 幂等：已关闭的 handle 再次关闭返回 closed:true
    return { kind: "completed", output: { ok: true, data: { closed: true } } };
  }
  const bridge = getClassFlowDesktopTerminalPtyBridge();
  if (bridge && bridge.closeSession) {
    try {
      await bridge.closeSession({ sessionId: record.sessionId });
    } catch {}
  }
  ptySessions.delete(sessionHandle);
  sessionIdToHandle.delete(record.sessionId);
  activePtyCommands.delete(record.sessionId);
  return { kind: "completed", output: { ok: true, data: { closed: true } } };
}
