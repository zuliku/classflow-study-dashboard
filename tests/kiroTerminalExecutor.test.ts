// @vitest-environment jsdom
/**
 * Desktop Terminal V1 — Terminal Executor 单元测试（memory bridge；不运行真实命令）。
 * - availability / native-only / cwd sandbox（bridge call = 0）
 * - policy（plan deny / guided ask / auto normal allow）
 * - Terminal Risk Gate（destructive/privileged → ask；blocked → deny）
 * - approval fingerprint（allow-once 精确绑定）
 * - output bounds + ANSI strip；exitCode 结构化事实；预算
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { executeKiroTerminalCommand } from "@/lib/ai/computer/terminal/executor";
import { classifyTerminalCommandRisk } from "@/lib/ai/computer/terminal/risk";
import { ComputerApprovalRequest } from "@/lib/ai/computer/approval";
import { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import { KiroWorkspaceMeta, ComputerPermissionRule } from "@/lib/ai/computer/types";
import { installMemoryDesktopBridgeMock } from "@/tests/helpers/memoryDesktopBridge";

type Ctl = {
  opCount: (op: string) => number;
  lastTerminalInput: () => { shell: string; cwd: string; command: string; grantId: string; timeoutMs: number } | null;
  setTerminalResultHook: (hook: null | ((input: { command: string }) => unknown)) => void;
  setTerminalRejectCode: (code: null | string) => void;
};
let ctl: Ctl;

const NATIVE_WORKSPACE: KiroWorkspaceMeta = {
  id: "research",
  name: "论文资料",
  roots: [{ id: "root-1", label: "论文资料", access: "read-write", adapterRef: "native:grant_mock_1" }],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const SANDBOX_WORKSPACE: KiroWorkspaceMeta = {
  id: "ws-sandbox",
  name: "内置",
  roots: [{ id: "root-s", label: "内置", access: "read-write", adapterRef: "sandbox-default" }],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function snapshot(over: Partial<KiroComputerTurnSnapshot> = {}): KiroComputerTurnSnapshot {
  return {
    enabled: true,
    workspaceId: "research",
    agentMode: "workspace-auto",
    roots: [{ id: "root-1", label: "论文资料", access: "read-write" }],
    terminalEnabled: true,
    terminalAvailable: true,
    hasNativeRoot: true,
    ...over,
  };
}

function input(over: Record<string, unknown> = {}) {
  return { shell: "powershell", cwd: "", command: "git status", ...over };
}

async function run(
  over: {
    toolInput?: Record<string, unknown>;
    snapshot?: KiroComputerTurnSnapshot;
    workspaces?: KiroWorkspaceMeta[];
    rules?: ComputerPermissionRule[];
    approvals?: Parameters<typeof executeKiroTerminalCommand>[0]["oneShotApprovals"];
    counters?: { readCount: number; mutationCount: number; terminalCount: number };
  } = {}
) {
  const counters = over.counters ?? { readCount: 0, mutationCount: 0, terminalCount: 0 };
  const attempt = await executeKiroTerminalCommand({
    toolCallId: "call-term-1",
    toolInput: over.toolInput ?? input(),
    snapshot: over.snapshot ?? snapshot(),
    liveWorkspaces: over.workspaces ?? [NATIVE_WORKSPACE],
    livePermissionRules: over.rules ?? [],
    counters,
    oneShotApprovals: over.approvals ?? [],
    taskId: "task-1",
  });
  return { attempt, counters };
}

/** 从 completed attempt 取结构化失败 code（ok:false 变体才有 code；避免 TS 联合收窄问题） */
function failCode(attempt: { kind: string; output?: unknown }): string | undefined {
  if (attempt.kind !== "completed") return undefined;
  const out = attempt.output as { ok?: boolean; code?: string } | undefined;
  return out?.code;
}

beforeEach(async () => {
  delete (window as unknown as Record<string, unknown>).classflowDesktop;
  delete (window as unknown as Record<string, unknown>).__desktopBridgeControl;
  installMemoryDesktopBridgeMock();
  ctl = (window as unknown as { __desktopBridgeControl: Ctl }).__desktopBridgeControl;
  // 预授权 grant_mock_1（mock 的 grant 由 pickDirectory 生成）
  await (window.classflowDesktop as { filesystem: { pickDirectory: (i: { access: string }) => Promise<unknown> } }).filesystem.pickDirectory({ access: "read-write" });
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).classflowDesktop;
  delete (window as unknown as Record<string, unknown>).__desktopBridgeControl;
});

describe("Terminal availability gating", () => {
  it("bridge terminal 缺失（filesystem-only bridge）→ TERMINAL_UNAVAILABLE（bridge 0 调用）", async () => {
    // filesystem-only：删除 terminal
    const b = window.classflowDesktop as unknown as { terminal?: unknown };
    delete b.terminal;
    const { attempt } = await run();
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(false);
    expect(failCode(attempt)).toBe("TERMINAL_UNAVAILABLE");
    expect(ctl.opCount("terminalExecute")).toBe(0);
  });

  it("terminalEnabled=false（preference）→ TERMINAL_UNAVAILABLE", async () => {
    const { attempt } = await run({ snapshot: snapshot({ terminalEnabled: false }) });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(failCode(attempt)).toBe("TERMINAL_UNAVAILABLE");
  });

  it("非 native workspace（sandbox）→ TERMINAL_NATIVE_WORKSPACE_REQUIRED（bridge 0 调用）", async () => {
    const { attempt } = await run({
      snapshot: snapshot({ workspaceId: "ws-sandbox", hasNativeRoot: false }),
      workspaces: [SANDBOX_WORKSPACE],
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(failCode(attempt)).toBe("TERMINAL_NATIVE_WORKSPACE_REQUIRED");
    expect(ctl.opCount("terminalExecute")).toBe(0);
  });

  it("read-only native root → READ_ONLY_ROOT", async () => {
    const ro: KiroWorkspaceMeta = {
      ...NATIVE_WORKSPACE,
      roots: [{ id: "root-1", label: "论文资料", access: "read-only", adapterRef: "native:grant_mock_1" }],
    };
    const { attempt } = await run({ workspaces: [ro] });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(failCode(attempt)).toBe("READ_ONLY_ROOT");
  });
});

describe("cwd Sandbox（PATH_OUTSIDE_SANDBOX 在 bridge 前拒绝）", () => {
  it.each(["../", "..\\secret.txt", "C:\\Windows", "/root/a", "\\\\server\\share"])(
    "escape cwd %s → PATH_OUTSIDE_SANDBOX；bridge execute = 0",
    async (bad) => {
      const { attempt } = await run({ toolInput: input({ cwd: bad }) });
      expect(attempt.kind).toBe("completed");
      if (attempt.kind !== "completed") return;
      expect(failCode(attempt)).toBe("PATH_OUTSIDE_SANDBOX");
      expect(ctl.opCount("terminalExecute")).toBe(0);
    }
  );

  it("multi-root 缺 rootId → ROOT_REQUIRED", async () => {
    const multi: KiroWorkspaceMeta = {
      ...NATIVE_WORKSPACE,
      roots: [
        { id: "root-1", label: "A", access: "read-write", adapterRef: "native:grant_mock_1" },
        { id: "root-2", label: "B", access: "read-write", adapterRef: "native:grant_mock_1" },
      ],
    };
    const { attempt } = await run({ workspaces: [multi] });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(failCode(attempt)).toBe("ROOT_REQUIRED");
    expect(ctl.opCount("terminalExecute")).toBe(0);
  });
});

describe("Policy + Risk Gate", () => {
  it("Plan：shell.execute = deny", async () => {
    const { attempt } = await run({ snapshot: snapshot({ agentMode: "plan" }) });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(failCode(attempt)).toBe("PERMISSION_DENIED");
  });

  it("Guided：普通命令 → approval-required（allowedDecisions 只有 deny/allow-once）", async () => {
    const { attempt } = await run({ snapshot: snapshot({ agentMode: "guided" }) });
    expect(attempt.kind).toBe("approval-required");
    if (attempt.kind !== "approval-required") return;
    const req = attempt.request as ComputerApprovalRequest;
    expect(req.allowedDecisions).toEqual(["deny", "allow-once"]);
    expect(req.fingerprint).toContain("terminal:powershell:root-1::git status");
    expect(req.commandPreview).toContain("git status");
  });

  it("Workspace Auto：普通命令 → 直接执行（无 approval；bridge execute +1）", async () => {
    const before = ctl.opCount("terminalExecute");
    const { attempt, counters } = await run();
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(true);
    expect(attempt.output.data).toMatchObject({ exitCode: 0, shell: "powershell", cwd: "" });
    expect(counters.terminalCount).toBe(1);
    expect(ctl.opCount("terminalExecute")).toBe(before + 1);
  });

  it.each([
    "Remove-Item temp.txt",
    "rm -rf temp",
    "del temp.txt",
    "git clean -fd",
    "git reset --hard HEAD",
    "Write-Output ok; Remove-Item x.txt",
    "cmd /c echo hi && del x.txt",
  ])("Workspace Auto destructive：%s → approval-required（bridge 0 调用）", async (command) => {
    const { attempt } = await run({ toolInput: input({ command }) });
    expect(attempt.kind).toBe("approval-required");
    if (attempt.kind !== "approval-required") return;
    const req = attempt.request as ComputerApprovalRequest;
    expect(req.terminalRisk).toBe("destructive");
    expect(req.description).toContain("可能删除或不可逆修改");
    expect(ctl.opCount("terminalExecute")).toBe(0);
  });

  it("Workspace Auto privileged（taskkill）→ approval-required", async () => {
    const { attempt } = await run({ toolInput: input({ command: "taskkill /PID 1234" }) });
    expect(attempt.kind).toBe("approval-required");
    if (attempt.kind !== "approval-required") return;
    expect((attempt.request as ComputerApprovalRequest).terminalRisk).toBe("privileged");
  });

  it.each([
    "powershell -EncodedCommand ABCDEF",
    "powershell -enc ABCDEF",
    "runas /user:admin cmd",
    "Start-Process notepad -Verb RunAs",
  ])("blocked：%s → TERMINAL_COMMAND_BLOCKED（bridge 0 调用）", async (command) => {
    const { attempt } = await run({ toolInput: input({ command }) });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(failCode(attempt)).toBe("TERMINAL_COMMAND_BLOCKED");
    expect(ctl.opCount("terminalExecute")).toBe(0);
  });

  it("空命令 → blocked", async () => {
    const { attempt } = await run({ toolInput: input({ command: "   " }) });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(failCode(attempt)).toBe("TERMINAL_COMMAND_BLOCKED");
  });

  it("explicit deny rule > workspace-auto allow", async () => {
    const rules: ComputerPermissionRule[] = [
      { id: "deny-shell", effect: "deny", capability: "shell.execute", workspaceId: "research", rootId: "root-1", scope: "persistent" },
    ];
    const { attempt } = await run({ rules });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(failCode(attempt)).toBe("PERMISSION_DENIED");
  });

  it("显式 allow rule 在 guided 下不能授予永久 shell 权限（仍 ask）", async () => {
    const rules: ComputerPermissionRule[] = [
      { id: "allow-shell", effect: "allow", capability: "shell.execute", workspaceId: "research", rootId: "root-1", scope: "persistent" },
    ];
    const { attempt } = await run({ snapshot: snapshot({ agentMode: "guided" }), rules });
    expect(attempt.kind).toBe("approval-required");
  });
});

describe("Approval fingerprint（allow-once 精确绑定；Guided 下每条命令都需批准）", () => {
  const guided = snapshot({ agentMode: "guided" });
  const oneShot = (fingerprint: string) => [
    { approvalId: "ap-1", toolCallId: "call-term-1", capability: "shell.execute" as const, workspaceId: "research", rootId: "root-1", relativePath: "", fingerprint },
  ];

  it("匹配 fingerprint（同一 command/cwd/shell）→ 执行", async () => {
    const before = ctl.opCount("terminalExecute");
    const fp = "terminal:powershell:root-1::git status";
    const { attempt } = await run({ snapshot: guided, approvals: oneShot(fp) });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(true);
    expect(ctl.opCount("terminalExecute")).toBe(before + 1);
  });

  it("command 不同 → 不能批准（approval-required）", async () => {
    const fp = "terminal:powershell:root-1::git status";
    const { attempt } = await run({ snapshot: guided, toolInput: input({ command: "npm test" }), approvals: oneShot(fp) });
    expect(attempt.kind).toBe("approval-required");
  });

  it("cwd 不同 → 不能批准", async () => {
    const fp = "terminal:powershell:root-1::git status";
    const { attempt } = await run({ snapshot: guided, toolInput: input({ cwd: "frontend" }), approvals: oneShot(fp) });
    expect(attempt.kind).toBe("approval-required");
  });

  it("shell 不同 → 不能批准", async () => {
    const fp = "terminal:powershell:root-1::git status";
    const { attempt } = await run({ snapshot: guided, toolInput: input({ shell: "cmd" }), approvals: oneShot(fp) });
    expect(attempt.kind).toBe("approval-required");
  });

  it("approval 只消费一次：第二次相同命令仍 approval-required", async () => {
    const fp = "terminal:powershell:root-1::git status";
    const approvals = oneShot(fp);
    await run({ snapshot: guided, approvals });
    expect(approvals).toHaveLength(0); // 已被 splice 消费
    const { attempt } = await run({ snapshot: guided });
    expect(attempt.kind).toBe("approval-required");
  });
});

describe("Output bounds / ANSI / 结构化事实", () => {
  it("stdout > 32K → truncated；ANSI 被 strip", async () => {
    ctl.setTerminalResultHook(({ command }) => ({
      exitCode: 0,
      stdout: "\u001B[31mred\u001B[0m " + "x".repeat(40_000),
      stderr: "",
      timedOut: false,
      durationMs: 10,
      stdoutTruncated: false,
      stderrTruncated: false,
    }));
    const { attempt } = await run({ toolInput: input({ command: "npm test" }) });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    const data = attempt.output.data as { stdout: string; truncated: boolean };
    expect(data.stdout).not.toContain("\u001B");
    expect(data.stdout.length).toBe(32_000);
    expect(data.truncated).toBe(true);
  });

  it("exitCode != 0 → 仍完成（结构化失败事实；不 crash）", async () => {
    ctl.setTerminalResultHook(() => ({
      exitCode: 1,
      stdout: "error: build failed",
      stderr: "tsc exited 1",
      timedOut: false,
      durationMs: 500,
      stdoutTruncated: false,
      stderrTruncated: false,
    }));
    const { attempt } = await run();
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(true);
    expect(attempt.output.data).toMatchObject({ exitCode: 1, stderr: "tsc exited 1" });
  });

  it("timedOut 明确返回", async () => {
    ctl.setTerminalResultHook(() => ({
      exitCode: null,
      stdout: "",
      stderr: "",
      timedOut: true,
      durationMs: 30_000,
      stdoutTruncated: false,
      stderrTruncated: false,
    }));
    const { attempt } = await run({ toolInput: input({ command: "npm install" }) });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.data).toMatchObject({ timedOut: true });
  });
});

describe("预算", () => {
  it("terminalCount >= 12 → PERMISSION_DENIED（bridge 0 调用）", async () => {
    const { attempt } = await run({
      counters: { readCount: 0, mutationCount: 0, terminalCount: 12 },
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(failCode(attempt)).toBe("PERMISSION_DENIED");
    expect(ctl.opCount("terminalExecute")).toBe(0);
  });
});

describe("classifyTerminalCommandRisk（纯函数）", () => {
  it("normal：git status / npm test / Get-ChildItem / script 文件执行", () => {
    expect(classifyTerminalCommandRisk("git status", "powershell")).toBe("normal");
    expect(classifyTerminalCommandRisk("git diff", "powershell")).toBe("normal");
    expect(classifyTerminalCommandRisk("npm test", "cmd")).toBe("normal");
    expect(classifyTerminalCommandRisk("npm run build", "powershell")).toBe("normal");
    expect(classifyTerminalCommandRisk("Get-ChildItem .", "powershell")).toBe("normal");
    expect(classifyTerminalCommandRisk("python script.py", "powershell")).toBe("normal");
    expect(classifyTerminalCommandRisk("node script.js", "powershell")).toBe("normal");
    expect(classifyTerminalCommandRisk("pytest", "powershell")).toBe("normal");
    expect(classifyTerminalCommandRisk("tsc", "powershell")).toBe("normal");
  });

  it("destructive：PowerShell 别名 / CMD / git 不可逆", () => {
    expect(classifyTerminalCommandRisk("Remove-Item x.txt", "powershell")).toBe("destructive");
    expect(classifyTerminalCommandRisk("rm -rf x", "powershell")).toBe("destructive");
    expect(classifyTerminalCommandRisk("del x.txt", "cmd")).toBe("destructive");
    expect(classifyTerminalCommandRisk("rd /s /q x", "cmd")).toBe("destructive");
    expect(classifyTerminalCommandRisk("git clean -fd", "powershell")).toBe("destructive");
    expect(classifyTerminalCommandRisk("git reset --hard HEAD", "powershell")).toBe("destructive");
    expect(classifyTerminalCommandRisk("git checkout -- .", "powershell")).toBe("destructive");
    expect(classifyTerminalCommandRisk("git restore .", "powershell")).toBe("destructive");
  });

  it("命令链任一 segment 命中 → 整条升级", () => {
    expect(classifyTerminalCommandRisk("Write-Output test; Remove-Item x.txt", "powershell")).toBe("destructive");
    expect(classifyTerminalCommandRisk("echo hi && del x.txt", "cmd")).toBe("destructive");
    expect(classifyTerminalCommandRisk("git status | Remove-Item x", "powershell")).toBe("destructive");
  });

  it("V1.0.1 cross-shell：outer shell 不匹配也检测另一套 destructive patterns", () => {
    // PowerShell outer + cmd /c del（quoted 内容仍被扫描）
    expect(classifyTerminalCommandRisk('cmd /c "del temp.txt"', "powershell")).toBe("destructive");
    expect(classifyTerminalCommandRisk('cmd /c "rd /s /q x"', "powershell")).toBe("destructive");
    expect(classifyTerminalCommandRisk('cmd /c "git clean -fd"', "powershell")).toBe("destructive");
    // CMD outer + powershell Remove-Item
    expect(classifyTerminalCommandRisk('powershell -Command "Remove-Item temp.txt"', "cmd")).toBe("destructive");
    expect(classifyTerminalCommandRisk('powershell -Command "Clear-Content x.txt"', "cmd")).toBe("destructive");
    // 同 shell 嵌套同样命中
    expect(classifyTerminalCommandRisk('powershell -Command "Remove-Item x"', "powershell")).toBe("destructive");
    expect(classifyTerminalCommandRisk('pwsh -Command "Remove-Item x"', "powershell")).toBe("destructive");
  });

  it("V1.0.1 nested shell：出现 cmd/powershell/pwsh 调用 → 至少 privileged", () => {
    expect(classifyTerminalCommandRisk('cmd /c "echo hello"', "powershell")).toBe("privileged");
    expect(classifyTerminalCommandRisk('cmd /k echo hi', "powershell")).toBe("privileged");
    expect(classifyTerminalCommandRisk('powershell -Command "Get-ChildItem"', "cmd")).toBe("privileged");
    expect(classifyTerminalCommandRisk('pwsh -Command "Get-ChildItem"', "cmd")).toBe("privileged");
    expect(classifyTerminalCommandRisk('powershell.exe -Command "Get-ChildItem"', "cmd")).toBe("privileged");
  });

  it("V1.0.1 inline interpreter：python -c / node -e / ruby -e / perl -e → 至少 privileged", () => {
    expect(classifyTerminalCommandRisk('python -c "import os; os.remove(\'x\')"', "powershell")).toBe("privileged");
    expect(classifyTerminalCommandRisk('python3 -c "print(1)"', "cmd")).toBe("privileged");
    expect(classifyTerminalCommandRisk('py -c "print(1)"', "powershell")).toBe("privileged");
    expect(classifyTerminalCommandRisk('node -e "require(\'fs\').unlinkSync(\'x\')"', "cmd")).toBe("privileged");
    expect(classifyTerminalCommandRisk('node --eval "console.log(1)"', "powershell")).toBe("privileged");
    expect(classifyTerminalCommandRisk('ruby -e "puts 1"', "powershell")).toBe("privileged");
    expect(classifyTerminalCommandRisk('perl -e "print 1"', "powershell")).toBe("privileged");
  });

  it("privileged：taskkill / reg delete / Stop-Process", () => {
    expect(classifyTerminalCommandRisk("taskkill /PID 1", "cmd")).toBe("privileged");
    expect(classifyTerminalCommandRisk("reg delete HKLM\\x /f", "cmd")).toBe("privileged");
    expect(classifyTerminalCommandRisk("Stop-Process -Name node", "powershell")).toBe("privileged");
    expect(classifyTerminalCommandRisk("shutdown /s", "cmd")).toBe("privileged");
  });

  it("blocked：EncodedCommand / runas / Start-Process -Verb RunAs；优先级 blocked > destructive", () => {
    expect(classifyTerminalCommandRisk("powershell -EncodedCommand QUJD", "powershell")).toBe("blocked");
    expect(classifyTerminalCommandRisk("powershell -enc QUJD; Remove-Item x", "powershell")).toBe("blocked");
    expect(classifyTerminalCommandRisk("runas /user:admin cmd", "cmd")).toBe("blocked");
    expect(classifyTerminalCommandRisk("Start-Process notepad -Verb RunAs", "powershell")).toBe("blocked");
    expect(classifyTerminalCommandRisk("", "powershell")).toBe("blocked");
    expect(classifyTerminalCommandRisk("   ", "cmd")).toBe("blocked");
  });
});

describe("V1.0.1 Policy 回归（nested shell / inline interpreter / cross-shell → approval）", () => {
  it.each([
    ['cmd /c "echo hi"'],
    ['cmd /c "del temp.txt"'],
    ['powershell -Command "Get-ChildItem"'],
    ['powershell -Command "Remove-Item x"'],
    ['python -c "print(1)"'],
    ['node -e "console.log(1)"'],
  ])("Workspace Auto：%s → approval-required（bridge execute = 0）", async (command) => {
    const { attempt } = await run({ toolInput: input({ command }) });
    expect(attempt.kind).toBe("approval-required");
    expect(ctl.opCount("terminalExecute")).toBe(0);
  });

  it("Guided：非 blocked 一律 approval-required（含 nested shell）", async () => {
    const { attempt } = await run({
      snapshot: snapshot({ agentMode: "guided" }),
      toolInput: input({ command: 'cmd /c "echo hello"' }),
    });
    expect(attempt.kind).toBe("approval-required");
  });

  it("Blocked：任何 mode 直接拒绝（含 Workspace Auto）", async () => {
    const { attempt } = await run({ toolInput: input({ command: "runas /user:admin cmd" }) });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(failCode(attempt)).toBe("TERMINAL_COMMAND_BLOCKED");
    expect(ctl.opCount("terminalExecute")).toBe(0);
  });
});

describe("V1.0.1 Bridge Error Contract（resolve/reject 语义冻结）", () => {
  it("resolve exitCode=1（正常完成，非 EXECUTION_FAILED）→ completed + exitCode=1", async () => {
    ctl.setTerminalResultHook(() => ({
      exitCode: 1,
      stdout: "error",
      stderr: "exit 1",
      timedOut: false,
      durationMs: 50,
      stdoutTruncated: false,
      stderrTruncated: false,
    }));
    const { attempt } = await run();
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(true);
    expect((attempt.output.data as { exitCode: number }).exitCode).toBe(1);
  });

  it("resolve timedOut=true（timeout 不是 reject）→ completed + timedOut=true", async () => {
    ctl.setTerminalResultHook(() => ({
      exitCode: null,
      stdout: "partial",
      stderr: "",
      timedOut: true,
      durationMs: 30000,
      stdoutTruncated: false,
      stderrTruncated: false,
    }));
    const { attempt } = await run();
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(true);
    expect((attempt.output.data as { timedOut: boolean }).timedOut).toBe(true);
  });

  it.each([
    ["PERMISSION_DENIED", "TERMINAL_PERMISSION_DENIED"],
    ["CANCELLED", "TERMINAL_CANCELLED"],
    ["EXECUTION_FAILED", "TERMINAL_EXECUTION_FAILED"],
    ["INVALID_OPERATION", "TERMINAL_EXECUTION_FAILED"],
  ])("reject %s → %s（固定文案；raw message 不泄漏）", async (rejectCode, expectedCode) => {
    ctl.setTerminalRejectCode(rejectCode);
    const { attempt } = await run();
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(false);
    expect(failCode(attempt)).toBe(expectedCode);
    const message = (attempt.output as { message: string }).message;
    expect(message).not.toContain("C:\\");
    expect(message).not.toContain("Users");
    expect(message).not.toContain("Alice");
    expect(message).not.toContain("secret.txt");
    expect(message).not.toContain("raw");
  });
});
