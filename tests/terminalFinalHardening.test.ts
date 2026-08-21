// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTerminalProcess } from "@/src/main/terminalRuntime";
import { buildSafeTerminalEnv } from "@/lib/ai/computer/terminal/env";
import {
  createInteractiveHandle,
  clearAllInteractiveHandles,
  activeInteractiveHandleCount,
  hasInteractiveHandle,
} from "@/lib/ai/computer/terminal/interactiveRegistry";

/**
 * Terminal V2 Final Hardening — P0 deterministic tests (TDD RED→GREEN)
 * Covers: PTY identity, PTY shell, PTY timeout/exit, env filtering, capacity
 */

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
      const regex = /Write-Output\s+"([^"]+)"/g;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(data)) !== null) {
        const content = m[1];
        if (content.startsWith("__CF_DONE_")) {
          const nonceMatch = content.match(/__CF_DONE_([a-z0-9]+)__/);
          const nonce = nonceMatch ? nonceMatch[1] : "unknown";
          const exitCodeMatch = content.match(/__CF_DONE_[a-z0-9]+__(\d+)/);
          const exitCode = exitCodeMatch ? exitCodeMatch[1] : "0";
          const sentinel = `__CF_DONE_${nonce}__${exitCode}`;
          const event = { type: "data", sessionId: input.sessionId, data: sentinel + "\r\n" };
          setTimeout(() => { for (const l of listeners) l(event); }, 20);
        } else {
          const event = { type: "data", sessionId: input.sessionId, data: content + "\r\n" };
          for (const l of listeners) l(event);
        }
      }
    },
    resizeSession: async () => {},
    closeSession: async (input: { sessionId: string }) => { sessions.delete(input.sessionId); },
    subscribeSession: (listener: (e: unknown) => void) => {
      listeners.push(listener);
      return () => { const idx = listeners.indexOf(listener); if (idx !== -1) listeners.splice(idx, 1); };
    },
  };
  return bridge as unknown as import("@/lib/desktop/types").ClassFlowDesktopTerminalBridgeV2;
}

function makeWorkspace(cwd: string, roots: { id: string; access: "read-write" | "read-only" }[]) {
  const grantIds = roots.map((r, i) => `grant-${i}`);
  const ws = {
    id: "ws-1",
    name: "Test Workspace",
    roots: roots.map((r, i) => ({ id: r.id, label: r.id, adapterRef: `native:${grantIds[i]}`, access: r.access })),
  };
  const snapshot = {
    enabled: true,
    workspaceId: ws.id,
    agentMode: "workspace-auto" as const,
    terminalEnabled: true,
    hasNativeRoot: true,
    terminalAvailable: true,
  };
  return { ws, snapshot };
}

beforeEach(() => {
  if (!window.matchMedia) {
    (window as unknown as { matchMedia: unknown }).matchMedia = () => ({
      matches: false, media: "", addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    });
  }
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} } as unknown as typeof ResizeObserver;
  }
});

afterEach(async () => {
  const { clearAllPtyHandles } = await import("@/lib/ai/computer/terminal/ptyAgent");
  clearAllPtyHandles();
  clearAllInteractiveHandles();
  delete (window as unknown as { classflowDesktop?: unknown }).classflowDesktop;
});

describe("P0: PTY shell — cmd unsupported, powershell ok", () => {
  it("create_terminal_session shell=cmd → UNSUPPORTED_TERMINAL_SHELL, run_terminal_command shell=cmd still works", async () => {
    const bridge = mockBridgeWithSession();
    (window as unknown as { classflowDesktop?: unknown }).classflowDesktop = {
      version: 1, platform: "windows" as const,
      filesystem: { pickDirectory: async () => null, getGrantStatus: async () => ({ status: "granted" as const }), forgetGrant: async () => {}, list: async () => [], stat: async () => null, readText: async () => "", readBytes: async () => new Uint8Array(), readTextPrefix: async () => ({ text: "", truncated: false }), createDirectory: async () => "created" as const, writeText: async () => {}, writeBytes: async () => {}, remove: async () => {}, move: async () => {} },
      terminal: bridge,
    };
    const { createKiroPtySession } = await import("@/lib/ai/computer/terminal/ptyAgent");
    const cwd = mkdtempSync(join(tmpdir(), "classflow-pty-hard-"));
    const { ws, snapshot } = makeWorkspace(cwd, [{ id: "root-1", access: "read-write" }]);
    const cmdAttempt = await createKiroPtySession({
      toolCallId: "call-cmd", toolInput: { shell: "cmd", cwd: "" },
      snapshot: snapshot as unknown as import("@/lib/ai/contextBudget/types").KiroComputerTurnSnapshot,
      liveWorkspaces: [ws as unknown as import("@/lib/ai/computer/types").KiroWorkspaceMeta],
      livePermissionRules: [], counters: { readCount: 0, mutationCount: 0, terminalCount: 0 }, oneShotApprovals: [], taskId: "task-1",
    });
    expect(cmdAttempt.kind).toBe("completed");
    if (cmdAttempt.kind === "completed") {
      expect(cmdAttempt.output.ok).toBe(false);
      expect(cmdAttempt.output.code).toBe("UNSUPPORTED_TERMINAL_SHELL");
    }
    const cwd2 = mkdtempSync(join(tmpdir(), "classflow-cmd-"));
    const { promise } = runTerminalProcess({ executionId: `term-cmd-${Date.now()}`, shell: "cmd", cwd: cwd2, command: "echo hello-cmd", timeoutMs: 5000, onEvent: () => {} });
    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello-cmd");
  });
});

describe("P0: PTY identity — binds to original workspace/root/shell", () => {
  it("create on root-B, run uses root-B for policy/audit (multi-root)", async () => {
    const bridge = mockBridgeWithSession();
    (window as unknown as { classflowDesktop?: unknown }).classflowDesktop = {
      version: 1, platform: "windows" as const,
      filesystem: { pickDirectory: async () => null, getGrantStatus: async () => ({ status: "granted" as const }), forgetGrant: async () => {}, list: async () => [], stat: async () => null, readText: async () => "", readBytes: async () => new Uint8Array(), readTextPrefix: async () => ({ text: "", truncated: false }), createDirectory: async () => "created" as const, writeText: async () => {}, writeBytes: async () => {}, remove: async () => {}, move: async () => {} },
      terminal: bridge,
    };
    const { createKiroPtySession, runKiroPtySessionCommand, getPtySessionRecord } = await import("@/lib/ai/computer/terminal/ptyAgent");
    const cwd = mkdtempSync(join(tmpdir(), "classflow-pty-id-"));
    const { ws, snapshot } = makeWorkspace(cwd, [{ id: "root-A", access: "read-write" }, { id: "root-B", access: "read-write" }]);
    const cr = await createKiroPtySession({
      toolCallId: "call-create", toolInput: { shell: "powershell", rootId: "root-B", cwd: "" },
      snapshot: snapshot as unknown as import("@/lib/ai/contextBudget/types").KiroComputerTurnSnapshot,
      liveWorkspaces: [ws as unknown as import("@/lib/ai/computer/types").KiroWorkspaceMeta],
      livePermissionRules: [], counters: { readCount: 0, mutationCount: 0, terminalCount: 0 }, oneShotApprovals: [], taskId: "task-1",
    });
    expect(cr.kind).toBe("completed");
    if (cr.kind !== "completed" || !cr.output.ok) throw new Error("create failed");
    const handle = (cr.output.data as { sessionHandle: string }).sessionHandle;
    const record = getPtySessionRecord(handle);
    expect(record?.rootId).toBe("root-B");
    expect(record?.shell).toBe("powershell");
    expect(record?.workspaceId).toBe("ws-1");
    const run = await runKiroPtySessionCommand({
      toolCallId: "call-run", toolInput: { sessionHandle: handle, command: 'Write-Output "identity-ok"' },
      snapshot: snapshot as unknown as import("@/lib/ai/contextBudget/types").KiroComputerTurnSnapshot,
      liveWorkspaces: [ws as unknown as import("@/lib/ai/computer/types").KiroWorkspaceMeta],
      livePermissionRules: [], counters: { readCount: 0, mutationCount: 0, terminalCount: 0 }, oneShotApprovals: [], taskId: "task-1",
    });
    expect(run.kind).toBe("completed");
    if (run.kind === "completed") expect(run.output.ok).toBe(true);
    const otherSnapshot = { ...snapshot, workspaceId: "other-ws" };
    const run2 = await runKiroPtySessionCommand({
      toolCallId: "call-run2", toolInput: { sessionHandle: handle, command: 'Write-Output "late"' },
      snapshot: otherSnapshot as unknown as import("@/lib/ai/contextBudget/types").KiroComputerTurnSnapshot,
      liveWorkspaces: [ws as unknown as import("@/lib/ai/computer/types").KiroWorkspaceMeta],
      livePermissionRules: [], counters: { readCount: 0, mutationCount: 0, terminalCount: 0 }, oneShotApprovals: [], taskId: "task-1",
    });
    expect(run2.kind).toBe("completed");
    if (run2.kind === "completed") expect(run2.output.ok).toBe(false);
  });
});

describe("P0: PTY lifecycle — timeout invalidates session", () => {
  it("run Start-Sleep 5 with timeout 1000 → TERMINAL_TIMEOUT and session invalidated", async () => {
    const bridge = mockBridgeWithSession();
    const hangBridge = {
      ...bridge,
      writeSession: async () => { /* never emit sentinel */ },
    } as unknown as import("@/lib/desktop/types").ClassFlowDesktopTerminalBridgeV2;
    (window as unknown as { classflowDesktop?: unknown }).classflowDesktop = {
      version: 1, platform: "windows" as const,
      filesystem: { pickDirectory: async () => null, getGrantStatus: async () => ({ status: "granted" as const }), forgetGrant: async () => {}, list: async () => [], stat: async () => null, readText: async () => "", readBytes: async () => new Uint8Array(), readTextPrefix: async () => ({ text: "", truncated: false }), createDirectory: async () => "created" as const, writeText: async () => {}, writeBytes: async () => {}, remove: async () => {}, move: async () => {} },
      terminal: hangBridge,
    };
    const { createKiroPtySession, runKiroPtySessionCommand, hasPtyHandle } = await import("@/lib/ai/computer/terminal/ptyAgent");
    const cwd = mkdtempSync(join(tmpdir(), "classflow-pty-to-"));
    const { ws, snapshot } = makeWorkspace(cwd, [{ id: "root-1", access: "read-write" }]);
    const cr = await createKiroPtySession({
      toolCallId: "call-create", toolInput: { shell: "powershell", cwd: "" },
      snapshot: snapshot as unknown as import("@/lib/ai/contextBudget/types").KiroComputerTurnSnapshot,
      liveWorkspaces: [ws as unknown as import("@/lib/ai/computer/types").KiroWorkspaceMeta],
      livePermissionRules: [], counters: { readCount: 0, mutationCount: 0, terminalCount: 0 }, oneShotApprovals: [], taskId: "task-1",
    });
    if (cr.kind !== "completed" || !cr.output.ok) throw new Error("create failed");
    const handle = (cr.output.data as { sessionHandle: string }).sessionHandle;
    const run = await runKiroPtySessionCommand({
      toolCallId: "call-run", toolInput: { sessionHandle: handle, command: "Start-Sleep -Seconds 5", timeoutMs: 1000 },
      snapshot: snapshot as unknown as import("@/lib/ai/contextBudget/types").KiroComputerTurnSnapshot,
      liveWorkspaces: [ws as unknown as import("@/lib/ai/computer/types").KiroWorkspaceMeta],
      livePermissionRules: [], counters: { readCount: 0, mutationCount: 0, terminalCount: 0 }, oneShotApprovals: [], taskId: "task-1",
    });
    expect(run.kind).toBe("completed");
    if (run.kind === "completed") expect(run.output.code).toBe("TERMINAL_TIMEOUT");
    expect(hasPtyHandle(handle)).toBe(false);
    const run2 = await runKiroPtySessionCommand({
      toolCallId: "call-run2", toolInput: { sessionHandle: handle, command: 'Write-Output "late"' },
      snapshot: snapshot as unknown as import("@/lib/ai/contextBudget/types").KiroComputerTurnSnapshot,
      liveWorkspaces: [ws as unknown as import("@/lib/ai/computer/types").KiroWorkspaceMeta],
      livePermissionRules: [], counters: { readCount: 0, mutationCount: 0, terminalCount: 0 }, oneShotApprovals: [], taskId: "task-1",
    });
    expect(run2.kind).toBe("completed");
    if (run2.kind === "completed") expect(run2.output.code).toBe("TERMINAL_NOT_FOUND");
  });
});

describe("P0: PTY lifecycle — exit invalidates handle", () => {
  it("close then run/write → TERMINAL_NOT_FOUND; exit event invalidates", async () => {
    const bridge = mockBridgeWithSession();
    (window as unknown as { classflowDesktop?: unknown }).classflowDesktop = {
      version: 1, platform: "windows" as const,
      filesystem: { pickDirectory: async () => null, getGrantStatus: async () => ({ status: "granted" as const }), forgetGrant: async () => {}, list: async () => [], stat: async () => null, readText: async () => "", readBytes: async () => new Uint8Array(), readTextPrefix: async () => ({ text: "", truncated: false }), createDirectory: async () => "created" as const, writeText: async () => {}, writeBytes: async () => {}, remove: async () => {}, move: async () => {} },
      terminal: bridge,
    };
    const { createKiroPtySession, closeKiroPtySession, runKiroPtySessionCommand, writeKiroPtySessionInput, hasPtyHandle } = await import("@/lib/ai/computer/terminal/ptyAgent");
    const cwd = mkdtempSync(join(tmpdir(), "classflow-pty-exit-"));
    const { ws, snapshot } = makeWorkspace(cwd, [{ id: "root-1", access: "read-write" }]);
    const cr = await createKiroPtySession({
      toolCallId: "call-create", toolInput: { shell: "powershell", cwd: "" },
      snapshot: snapshot as unknown as import("@/lib/ai/contextBudget/types").KiroComputerTurnSnapshot,
      liveWorkspaces: [ws as unknown as import("@/lib/ai/computer/types").KiroWorkspaceMeta],
      livePermissionRules: [], counters: { readCount: 0, mutationCount: 0, terminalCount: 0 }, oneShotApprovals: [], taskId: "task-1",
    });
    if (cr.kind !== "completed" || !cr.output.ok) throw new Error("create failed");
    const handle = (cr.output.data as { sessionHandle: string }).sessionHandle;
    const c1 = await closeKiroPtySession({
      toolCallId: "call-close1", toolInput: { sessionHandle: handle },
      snapshot: snapshot as unknown as import("@/lib/ai/contextBudget/types").KiroComputerTurnSnapshot,
      liveWorkspaces: [ws as unknown as import("@/lib/ai/computer/types").KiroWorkspaceMeta],
      livePermissionRules: [], counters: { readCount: 0, mutationCount: 0, terminalCount: 0 }, oneShotApprovals: [], taskId: "task-1",
    });
    expect(c1.kind).toBe("completed");
    if (c1.kind === "completed") expect(c1.output.ok).toBe(true);
    expect(hasPtyHandle(handle)).toBe(false);
    const c2 = await closeKiroPtySession({
      toolCallId: "call-close2", toolInput: { sessionHandle: handle },
      snapshot: snapshot as unknown as import("@/lib/ai/contextBudget/types").KiroComputerTurnSnapshot,
      liveWorkspaces: [ws as unknown as import("@/lib/ai/computer/types").KiroWorkspaceMeta],
      livePermissionRules: [], counters: { readCount: 0, mutationCount: 0, terminalCount: 0 }, oneShotApprovals: [], taskId: "task-1",
    });
    expect(c2.kind).toBe("completed");
    const run = await runKiroPtySessionCommand({
      toolCallId: "call-run", toolInput: { sessionHandle: handle, command: 'Write-Output "late"' },
      snapshot: snapshot as unknown as import("@/lib/ai/contextBudget/types").KiroComputerTurnSnapshot,
      liveWorkspaces: [ws as unknown as import("@/lib/ai/computer/types").KiroWorkspaceMeta],
      livePermissionRules: [], counters: { readCount: 0, mutationCount: 0, terminalCount: 0 }, oneShotApprovals: [], taskId: "task-1",
    });
    expect(run.kind).toBe("completed");
    if (run.kind === "completed") expect(run.output.code).toBe("TERMINAL_NOT_FOUND");
    const w = await writeKiroPtySessionInput({
      toolCallId: "call-write", toolInput: { sessionHandle: handle, data: "hello" },
      snapshot: snapshot as unknown as import("@/lib/ai/contextBudget/types").KiroComputerTurnSnapshot,
      liveWorkspaces: [ws as unknown as import("@/lib/ai/computer/types").KiroWorkspaceMeta],
      livePermissionRules: [], counters: { readCount: 0, mutationCount: 0, terminalCount: 0 }, oneShotApprovals: [], taskId: "task-1",
    });
    expect(w.kind).toBe("completed");
    if (w.kind === "completed") expect(w.output.ok).toBe(false);
  });
});

describe("P0: Interactive registry capacity", () => {
  it("33rd active handle → TOO_MANY_ACTIVE_TERMINALS, first 32 still exist", async () => {
    clearAllInteractiveHandles();
    const { createInteractiveHandle, activeInteractiveHandleCount } = await import("@/lib/ai/computer/terminal/interactiveRegistry");
    const handles: string[] = [];
    for (let i = 0; i < 32; i++) {
      handles.push(createInteractiveHandle(`exec-${i}`, `call-${i}`, "powershell", `cmd-${i}`));
    }
    expect(activeInteractiveHandleCount()).toBe(32);
    expect(() => createInteractiveHandle("exec-32", "call-32", "powershell", "cmd-32")).toThrow();
    expect(hasInteractiveHandle(handles[0])).toBe(true);
    expect(activeInteractiveHandleCount()).toBe(32);
    clearAllInteractiveHandles();
  });
});

describe("P0: run_terminal_command no longer returns terminalHandle", () => {
  it("run returns no terminalHandle, start returns handle", async () => {
    const bridge = mockBridgeWithSession();
    (window as unknown as { classflowDesktop?: unknown }).classflowDesktop = {
      version: 1, platform: "windows" as const,
      filesystem: { pickDirectory: async () => null, getGrantStatus: async () => ({ status: "granted" as const }), forgetGrant: async () => {}, list: async () => [], stat: async () => null, readText: async () => "", readBytes: async () => new Uint8Array(), readTextPrefix: async () => ({ text: "", truncated: false }), createDirectory: async () => "created" as const, writeText: async () => {}, writeBytes: async () => {}, remove: async () => {}, move: async () => {} },
      terminal: bridge,
    };
    const fs = await import("node:fs");
    const content = fs.readFileSync("lib/ai/computer/terminal/executor.ts", "utf8");
    const runOutputSection = content.slice(content.indexOf("export async function executeKiroTerminalCommand"), content.indexOf("export async function startKiroTerminalCommand"));
    expect(runOutputSection).not.toContain("terminalHandle");
    expect(content).toContain("export async function startKiroTerminalCommand");
  });
});

describe("P1: child env filtering", () => {
  it("buildSafeTerminalEnv removes sensitive keys, keeps PATH etc", async () => {
    const { buildSafeTerminalEnv } = await import("@/lib/ai/computer/terminal/env");
    const env: NodeJS.ProcessEnv = {
      PATH: "/usr/bin",
      API_KEY: "secret",
      OPENCODE_GO_TEST_API_KEY: "fake-secret",
      MY_TOKEN: "tok",
      SECRET_VALUE: "s",
      PASSWORD: "p",
      NORMAL_VAR: "keep",
      TEMP: "C:\\Temp",
    };
    const safe = buildSafeTerminalEnv(env);
    expect(safe.PATH).toBe("/usr/bin");
    expect(safe.TEMP).toBe("C:\\Temp");
    expect(safe.NORMAL_VAR).toBe("keep");
    expect(safe.API_KEY).toBeUndefined();
    expect(safe.OPENCODE_GO_TEST_API_KEY).toBeUndefined();
    expect(safe.MY_TOKEN).toBeUndefined();
    expect(safe.SECRET_VALUE).toBeUndefined();
    expect(safe.PASSWORD).toBeUndefined();
  });

  it("real PowerShell does not see fake env (CLASSFLOW_FAKE_API_KEY)", async () => {
    process.env.CLASSFLOW_FAKE_API_KEY = "fake-secret-for-test-xyz";
    const cwd = mkdtempSync(join(tmpdir(), "classflow-env-"));
    const { promise } = runTerminalProcess({
      executionId: `term-env-${Date.now()}`,
      shell: "powershell",
      cwd,
      command: 'if ($env:CLASSFLOW_FAKE_API_KEY) { Write-Output "leaked" } else { Write-Output "clean" }',
      timeoutMs: 8000,
      onEvent: () => {},
    });
    const result = await promise;
    delete process.env.CLASSFLOW_FAKE_API_KEY;
    expect(result.stdout).toContain("clean");
    expect(result.stdout).not.toContain("leaked");
  }, 10000);
});
