// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// PTY Agent 高层工具集成测试（不依赖真实 Electron IPC，仅验证 per-command Risk Gate + sentinel 脱敏 + handle 生命周期）

function mockBridgeWithSession() {
  const sessions = new Map<string, { handle: string; buffer: string }>();
  const listeners: ((e: unknown) => void)[] = [];
  const bridge = {
    version: 2,
    execute: async () => ({}),
    cancel: async () => {},
    start: async () => ({}),
    subscribe: () => () => {},
    write: async () => {},
    createSession: async (input: { shell: string; grantId: string; cwd: string; cols: number; rows: number }) => {
      const sessionId = `pty-${Math.random().toString(36).slice(2, 8)}`;
      sessions.set(sessionId, { handle: sessionId, buffer: "" });
      return { sessionId };
    },
    writeSession: async (input: { sessionId: string; data: string }) => {
      const rec = sessions.get(input.sessionId);
      if (!rec) throw { code: "INVALID_OPERATION" };
      const data = input.data;
      // 提取所有 Write-Output "..." 内容（包括用户命令和 sentinel）
      const regex = /Write-Output\s+"([^"]+)"/g;
      let match: RegExpExecArray | null;
      let hasMatch = false;
      while ((match = regex.exec(data)) !== null) {
        hasMatch = true;
        const content = match[1];
        if (content.startsWith("__CF_DONE_")) {
          const nonceMatch = content.match(/__CF_DONE_([a-z0-9]+)__/);
          const nonce = nonceMatch ? nonceMatch[1] : "unknown";
          const exitCodeMatch = content.match(/__CF_DONE_[a-z0-9]+__(\d+)/);
          const exitCode = exitCodeMatch ? exitCodeMatch[1] : "0";
          const sentinel = `__CF_DONE_${nonce}__${exitCode}`;
          const event = { type: "data", sessionId: input.sessionId, data: sentinel + "\r\n" };
          setTimeout(() => {
            for (const l of listeners) l(event);
          }, 20);
        } else {
          const event = { type: "data", sessionId: input.sessionId, data: content + "\r\n" };
          for (const l of listeners) l(event);
        }
      }
      if (!hasMatch && data.trim().length > 0) {
        // 非 Write-Output 命令（如 Set-Location）不产生直接输出，但 sentinel 已在上层处理
      }
    },
    resizeSession: async () => {},
    closeSession: async (input: { sessionId: string }) => {
      sessions.delete(input.sessionId);
    },
    subscribeSession: (listener: (e: unknown) => void) => {
      listeners.push(listener);
      return () => {
        const idx = listeners.indexOf(listener);
        if (idx !== -1) listeners.splice(idx, 1);
      };
    },
  };
  return bridge as unknown as import("@/lib/desktop/types").ClassFlowDesktopTerminalBridgeV2;
}

function mockWorkspace(cwd: string) {
  const grantId = "test-grant-1";
  const ws = {
    id: "ws-1",
    name: "Test Workspace",
    roots: [{ id: "root-1", label: "Root", adapterRef: `native:${grantId}`, access: "read-write" as const }],
  };
  const snapshot = {
    enabled: true,
    workspaceId: ws.id,
    agentMode: "workspace-auto" as const,
    terminalEnabled: true,
    hasNativeRoot: true,
    terminalAvailable: true,
  };
  return { ws, snapshot, grantId, cwd };
}

beforeEach(() => {
  // jsdom window mock
  if (!window.matchMedia) {
    (window as unknown as { matchMedia: unknown }).matchMedia = () => ({
      matches: false,
      media: "",
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }
});

afterEach(async () => {
  const { clearAllPtyHandles } = await import("@/lib/ai/computer/terminal/ptyAgent");
  clearAllPtyHandles();
  // 清理 window mock
  delete (window as unknown as { classflowDesktop?: unknown }).classflowDesktop;
});

describe("PTY Agent — typed contract & per-command Risk Gate", () => {
  it("create → run blocked command → TERMINAL_COMMAND_BLOCKED（绝不调用 PTY）", async () => {
    const bridge = mockBridgeWithSession();
    (window as unknown as { classflowDesktop?: unknown }).classflowDesktop = {
      version: 1,
      platform: "windows" as const,
      filesystem: {
        pickDirectory: async () => null,
        getGrantStatus: async () => ({ status: "granted" as const }),
        forgetGrant: async () => {},
        list: async () => [],
        stat: async () => null,
        readText: async () => "",
        readBytes: async () => new Uint8Array(),
        readTextPrefix: async () => ({ text: "", truncated: false }),
        createDirectory: async () => "created" as const,
        writeText: async () => {},
        writeBytes: async () => {},
        remove: async () => {},
        move: async () => {},
      },
      terminal: bridge,
    };
    const { createKiroPtySession, runKiroPtySessionCommand } = await import("@/lib/ai/computer/terminal/ptyAgent");
    const cwd = mkdtempSync(join(tmpdir(), "classflow-pty-agent-"));
    const { ws, snapshot } = mockWorkspace(cwd);
    const createResult = await createKiroPtySession({
      toolCallId: "call-create",
      toolInput: { shell: "powershell", cwd: "" },
      snapshot: snapshot as unknown as import("@/lib/ai/contextBudget/types").KiroComputerTurnSnapshot,
      liveWorkspaces: [ws as unknown as import("@/lib/ai/computer/types").KiroWorkspaceMeta],
      livePermissionRules: [],
      counters: { readCount: 0, mutationCount: 0, terminalCount: 0 },
      oneShotApprovals: [],
      taskId: "task-1",
    });
    expect(createResult.kind).toBe("completed");
    if (createResult.kind !== "completed" || !createResult.output.ok) throw new Error("create failed");
    const handle = (createResult.output.data as { sessionHandle: string }).sessionHandle;

    // 尝试执行被 blocked 的命令（Start-Process -Verb RunAs）
    const blocked = await runKiroPtySessionCommand({
      toolCallId: "call-run-blocked",
      toolInput: { sessionHandle: handle, command: "Start-Process notepad -Verb RunAs" },
      snapshot: snapshot as unknown as import("@/lib/ai/contextBudget/types").KiroComputerTurnSnapshot,
      liveWorkspaces: [ws as unknown as import("@/lib/ai/computer/types").KiroWorkspaceMeta],
      livePermissionRules: [],
      counters: { readCount: 0, mutationCount: 0, terminalCount: 0 },
      oneShotApprovals: [],
      taskId: "task-1",
    });
    expect(blocked.kind).toBe("completed");
    if (blocked.kind === "completed") {
      expect(blocked.output.ok).toBe(false);
      expect(blocked.output.code).toBe("TERMINAL_COMMAND_BLOCKED");
    }
  });

  it("run command 的 sentinel 不泄漏到模型输出", async () => {
    const bridge = mockBridgeWithSession();
    (window as unknown as { classflowDesktop?: unknown }).classflowDesktop = {
      version: 1,
      platform: "windows" as const,
      filesystem: {
        pickDirectory: async () => null,
        getGrantStatus: async () => ({ status: "granted" as const }),
        forgetGrant: async () => {},
        list: async () => [],
        stat: async () => null,
        readText: async () => "",
        readBytes: async () => new Uint8Array(),
        readTextPrefix: async () => ({ text: "", truncated: false }),
        createDirectory: async () => "created" as const,
        writeText: async () => {},
        writeBytes: async () => {},
        remove: async () => {},
        move: async () => {},
      },
      terminal: bridge,
    };
    const { createKiroPtySession, runKiroPtySessionCommand } = await import("@/lib/ai/computer/terminal/ptyAgent");
    const cwd = mkdtempSync(join(tmpdir(), "classflow-pty-agent-"));
    const { ws, snapshot } = mockWorkspace(cwd);
    const cr = await createKiroPtySession({
      toolCallId: "call-create2",
      toolInput: { shell: "powershell", cwd: "" },
      snapshot: snapshot as unknown as import("@/lib/ai/contextBudget/types").KiroComputerTurnSnapshot,
      liveWorkspaces: [ws as unknown as import("@/lib/ai/computer/types").KiroWorkspaceMeta],
      livePermissionRules: [],
      counters: { readCount: 0, mutationCount: 0, terminalCount: 0 },
      oneShotApprovals: [],
      taskId: "task-1",
    });
    if (cr.kind !== "completed" || !cr.output.ok) throw new Error("create failed");
    const handle = (cr.output.data as { sessionHandle: string }).sessionHandle;
    const run = await runKiroPtySessionCommand({
      toolCallId: "call-run",
      toolInput: { sessionHandle: handle, command: 'Write-Output "pty-agent-ok"' },
      snapshot: snapshot as unknown as import("@/lib/ai/contextBudget/types").KiroComputerTurnSnapshot,
      liveWorkspaces: [ws as unknown as import("@/lib/ai/computer/types").KiroWorkspaceMeta],
      livePermissionRules: [],
      counters: { readCount: 0, mutationCount: 0, terminalCount: 0 },
      oneShotApprovals: [],
      taskId: "task-1",
    });
    // eslint-disable-next-line no-console
    console.log("run result", JSON.stringify(run));
    if (run.kind !== "completed" || !run.output.ok) throw new Error(`run failed: ${JSON.stringify(run)}`);
    const data = run.output.data as { output: string };
    expect(data.output).toContain("pty-agent-ok");
    expect(data.output).not.toContain("__CF_DONE_");
  }, 15000);

  it("PTY 输出 secret 被脱敏（不含 raw）", async () => {
    const bridge = mockBridgeWithSession();
    // 直接测试 redact：PTY 的 run 输出经 sanitizeTerminalModelOutput
    const { sanitizeTerminalModelOutput } = await import("@/lib/ai/computer/terminal/redact");
    const fake = "sk-fake-secret-pty1234567890";
    const out = sanitizeTerminalModelOutput(`output ${fake} at C:\\Users\\alice\\f.txt`, 1000);
    expect(out.text).not.toContain(fake);
    expect(out.text).not.toContain("C:\\Users\\alice");
    expect(out.text).toContain("[REDACTED_SECRET]");
  });

  it("close 后 write 被拒绝", async () => {
    const bridge = mockBridgeWithSession();
    (window as unknown as { classflowDesktop?: unknown }).classflowDesktop = {
      version: 1,
      platform: "windows" as const,
      filesystem: {
        pickDirectory: async () => null,
        getGrantStatus: async () => ({ status: "granted" as const }),
        forgetGrant: async () => {},
        list: async () => [],
        stat: async () => null,
        readText: async () => "",
        readBytes: async () => new Uint8Array(),
        readTextPrefix: async () => ({ text: "", truncated: false }),
        createDirectory: async () => "created" as const,
        writeText: async () => {},
        writeBytes: async () => {},
        remove: async () => {},
        move: async () => {},
      },
      terminal: bridge,
    };
    const { createKiroPtySession, closeKiroPtySession, writeKiroPtySessionInput } = await import("@/lib/ai/computer/terminal/ptyAgent");
    const cwd = mkdtempSync(join(tmpdir(), "classflow-pty-agent-"));
    const { ws, snapshot } = mockWorkspace(cwd);
    const cr = await createKiroPtySession({
      toolCallId: "call-create3",
      toolInput: { shell: "powershell", cwd: "" },
      snapshot: snapshot as unknown as import("@/lib/ai/contextBudget/types").KiroComputerTurnSnapshot,
      liveWorkspaces: [ws as unknown as import("@/lib/ai/computer/types").KiroWorkspaceMeta],
      livePermissionRules: [],
      counters: { readCount: 0, mutationCount: 0, terminalCount: 0 },
      oneShotApprovals: [],
      taskId: "task-1",
    });
    if (cr.kind !== "completed" || !cr.output.ok) throw new Error("create failed");
    const handle = (cr.output.data as { sessionHandle: string }).sessionHandle;
    const closed = await closeKiroPtySession({
      toolCallId: "call-close",
      toolInput: { sessionHandle: handle },
      snapshot: snapshot as unknown as import("@/lib/ai/contextBudget/types").KiroComputerTurnSnapshot,
      liveWorkspaces: [ws as unknown as import("@/lib/ai/computer/types").KiroWorkspaceMeta],
      livePermissionRules: [],
      counters: { readCount: 0, mutationCount: 0, terminalCount: 0 },
      oneShotApprovals: [],
      taskId: "task-1",
    });
    expect(closed.kind).toBe("completed");
    const w = await writeKiroPtySessionInput({
      toolCallId: "call-write-after",
      toolInput: { sessionHandle: handle, data: "hello" },
      snapshot: snapshot as unknown as import("@/lib/ai/contextBudget/types").KiroComputerTurnSnapshot,
      liveWorkspaces: [ws as unknown as import("@/lib/ai/computer/types").KiroWorkspaceMeta],
      livePermissionRules: [],
      counters: { readCount: 0, mutationCount: 0, terminalCount: 0 },
      oneShotApprovals: [],
      taskId: "task-1",
    });
    expect(w.kind).toBe("completed");
    if (w.kind === "completed") expect(w.output.ok).toBe(false);
  });
});
