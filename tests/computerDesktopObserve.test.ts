// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  executeKiroObserveDesktop,
  OBSERVE_DESKTOP_TOOL_NAME,
} from "@/lib/ai/computer/desktop/observe";
import { executeKiroComputerTool } from "@/lib/ai/computer/executor";
import { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import { KiroWorkspaceMeta } from "@/lib/ai/computer/types";
import type { ClassFlowDesktopComputerObservation } from "@/lib/desktop/types";

const WORKSPACE: KiroWorkspaceMeta = {
  id: "ws-1",
  name: "课程资料",
  roots: [{ id: "root-1", label: "资料", access: "read-write", adapterRef: "sandbox-default" }],
  createdAt: "2026-09-21T00:00:00.000Z",
  updatedAt: "2026-09-21T00:00:00.000Z",
};

function snapshot(overrides: Partial<KiroComputerTurnSnapshot> = {}): KiroComputerTurnSnapshot {
  return {
    enabled: true,
    workspaceId: "ws-1",
    agentMode: "workspace-auto",
    roots: [{ id: "root-1", label: "资料", access: "read-write" }],
    desktopControlEnabled: true,
    desktopControlAvailable: true,
    ...overrides,
  };
}

function observation(overrides: Partial<ClassFlowDesktopComputerObservation> = {}): ClassFlowDesktopComputerObservation {
  return {
    observationId: "obs-11111111-2222-3333-4444-555555555555",
    target: "active-window",
    appName: "notepad",
    windowTitle: "无标题 - 记事本",
    windowId: "win-3f9a2c1b4d5e",
    viewport: { width: 1280, height: 720 },
    windows: [
      { windowId: "win-3f9a2c1b4d5e", title: "无标题 - 记事本", appName: "notepad", active: true },
      { windowId: "win-aaaaaaaaaaaa", title: "QQ", appName: "QQ", active: false },
    ],
    windowsTruncated: false,
    elements: [
      {
        elementId: "el-1",
        role: "Window",
        name: "无标题 - 记事本",
        enabled: true,
        focused: true,
        bounds: { x: 0, y: 0, width: 1280, height: 720 },
      },
      {
        elementId: "el-2",
        role: "Button",
        name: "保存",
        enabled: true,
        focused: false,
        bounds: { x: 10, y: 10, width: 60, height: 24 },
      },
    ],
    elementCount: 2,
    elementsTruncated: false,
    screenshot: {
      captured: true,
      mimeType: "image/jpeg",
      width: 960,
      height: 540,
      bytes: 123456,
      capturedAt: "2026-09-21T00:00:01.000Z",
      dataUrl: "data:image/jpeg;base64,AAAA",
    },
    warnings: [],
    uiTreeRevision: 7,
    capturedAt: "2026-09-21T00:00:01.000Z",
    ...overrides,
  };
}

const filesystemStub = {
  pickDirectory: async () => null,
  getGrantStatus: async () => ({ status: "granted" as const }),
  forgetGrant: async () => undefined,
  list: async () => [],
  stat: async () => null,
  readText: async () => "",
  readBytes: async () => new Uint8Array(),
  readTextPrefix: async () => ({ text: "", truncated: false }),
  createDirectory: async () => "created" as const,
  writeText: async () => undefined,
  writeBytes: async () => undefined,
  remove: async () => undefined,
  move: async () => undefined,
};

function installBridge(options: {
  observe?: (input: unknown) => Promise<ClassFlowDesktopComputerObservation>;
} = {}) {
  const observe = vi.fn(options.observe ?? (async () => observation()));
  const capabilities = vi.fn(async () => ({
    available: true,
    platform: "windows",
    screenshot: true,
    uiAutomation: true,
  }));
  (window as unknown as { classflowDesktop?: unknown }).classflowDesktop = {
    version: 1,
    platform: "windows",
    filesystem: filesystemStub,
    computer: { version: 1, capabilities, observe },
  };
  return { observe, capabilities };
}

function counters() {
  return { readCount: 0, mutationCount: 0, terminalCount: 0 };
}

const READ_LIMIT = 12;

afterEach(() => {
  delete (window as unknown as { classflowDesktop?: unknown }).classflowDesktop;
});

describe("executeKiroObserveDesktop — 成功链路", () => {
  it("返回 observationId / 应用 / 窗口 / viewport / elements / screenshot evidence", async () => {
    const { observe } = installBridge();
    const attempt = await executeKiroObserveDesktop({
      toolCallId: "call-1",
      toolInput: {},
      snapshot: snapshot(),
      liveWorkspaces: [WORKSPACE],
      livePermissionRules: [],
      counters: counters(),
      oneShotApprovals: [],
      taskId: "task-1",
      readLimitPerTurn: READ_LIMIT,
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(true);
    const data = attempt.output.data as Record<string, unknown>;
    expect(data.observationId).toBe("obs-11111111-2222-3333-4444-555555555555");
    expect(data.appName).toBe("notepad");
    expect(data.windowTitle).toBe("无标题 - 记事本");
    expect(data.windowId).toBe("win-3f9a2c1b4d5e");
    expect(data.viewport).toEqual({ width: 1280, height: 720 });
    expect(data.windows).toEqual([
      { windowId: "win-3f9a2c1b4d5e", title: "无标题 - 记事本", appName: "notepad", active: true },
      { windowId: "win-aaaaaaaaaaaa", title: "QQ", appName: "QQ", active: false },
    ]);
    expect(data.elementCount).toBe(2);
    expect(data.readOnly).toBe(true);
    expect(observe).toHaveBeenCalledTimes(1);
  });

  it("截图 evidence 只含 metadata（dataUrl 不进入模型输出）", async () => {
    installBridge();
    const attempt = await executeKiroObserveDesktop({
      toolCallId: "call-2",
      toolInput: { includeScreenshot: true, includeUiTree: true },
      snapshot: snapshot(),
      liveWorkspaces: [WORKSPACE],
      livePermissionRules: [],
      counters: counters(),
      oneShotApprovals: [],
      taskId: "task-1",
      readLimitPerTurn: READ_LIMIT,
    });
    const serialized = JSON.stringify(attempt);
    expect(serialized).not.toContain("data:image");
    expect(serialized).not.toContain("base64");
    expect(serialized).not.toContain("hwnd");
    expect(serialized).not.toContain("pid");
    expect(serialized).not.toContain("nativeRef");
    if (attempt.kind !== "completed" || !attempt.output.ok) throw new Error("expected ok");
    const screenshot = (attempt.output.data as { screenshot: Record<string, unknown> }).screenshot;
    expect(screenshot).toEqual({
      captured: true,
      mimeType: "image/jpeg",
      width: 960,
      height: 540,
      bytes: 123456,
      capturedAt: "2026-09-21T00:00:01.000Z",
    });
  });

  it("成功观察消耗 1 次 read 预算", async () => {
    installBridge();
    const c = counters();
    await executeKiroObserveDesktop({
      toolCallId: "call-3",
      toolInput: {},
      snapshot: snapshot(),
      liveWorkspaces: [WORKSPACE],
      livePermissionRules: [],
      counters: c,
      oneShotApprovals: [],
      taskId: "task-1",
      readLimitPerTurn: READ_LIMIT,
    });
    expect(c.readCount).toBe(1);
    expect(c.mutationCount).toBe(0);
  });
});

describe("executeKiroObserveDesktop — 准入门禁", () => {
  it("desktopControlEnabled=false → PERMISSION_DENIED（不调用 Bridge）", async () => {
    const { observe } = installBridge();
    const attempt = await executeKiroObserveDesktop({
      toolCallId: "call-4",
      toolInput: {},
      snapshot: snapshot({ desktopControlEnabled: false }),
      liveWorkspaces: [WORKSPACE],
      livePermissionRules: [],
      counters: counters(),
      oneShotApprovals: [],
      taskId: "task-1",
      readLimitPerTurn: READ_LIMIT,
    });
    expect(attempt).toMatchObject({ kind: "completed", output: { ok: false, code: "PERMISSION_DENIED" } });
    expect(observe).not.toHaveBeenCalled();
  });

  it("desktopControlAvailable=false（Web runtime）→ PERMISSION_DENIED", async () => {
    installBridge();
    const attempt = await executeKiroObserveDesktop({
      toolCallId: "call-5",
      toolInput: {},
      snapshot: snapshot({ desktopControlAvailable: false }),
      liveWorkspaces: [WORKSPACE],
      livePermissionRules: [],
      counters: counters(),
      oneShotApprovals: [],
      taskId: "task-1",
      readLimitPerTurn: READ_LIMIT,
    });
    expect(attempt).toMatchObject({ kind: "completed", output: { ok: false, code: "PERMISSION_DENIED" } });
  });

  it("无 Bridge（未安装 desktop runtime）→ PERMISSION_DENIED", async () => {
    const attempt = await executeKiroObserveDesktop({
      toolCallId: "call-6",
      toolInput: {},
      snapshot: snapshot(),
      liveWorkspaces: [WORKSPACE],
      livePermissionRules: [],
      counters: counters(),
      oneShotApprovals: [],
      taskId: "task-1",
      readLimitPerTurn: READ_LIMIT,
    });
    expect(attempt).toMatchObject({ kind: "completed", output: { ok: false, code: "PERMISSION_DENIED" } });
  });

  it("explicit deny rule（screen.observe）→ 拒绝且不调用 Bridge", async () => {
    const { observe } = installBridge();
    const attempt = await executeKiroObserveDesktop({
      toolCallId: "call-7",
      toolInput: {},
      snapshot: snapshot(),
      liveWorkspaces: [WORKSPACE],
      livePermissionRules: [
        { id: "deny-observe", effect: "deny", capability: "screen.observe", scope: "persistent" },
      ],
      counters: counters(),
      oneShotApprovals: [],
      taskId: "task-1",
      readLimitPerTurn: READ_LIMIT,
    });
    expect(attempt).toMatchObject({ kind: "completed", output: { ok: false, code: "PERMISSION_DENIED" } });
    expect(observe).not.toHaveBeenCalled();
  });

  it("explicit deny rule（ui.inspect）→ includeUiTree=true 拒绝；false 放行", async () => {
    installBridge();
    const denyUi = {
      id: "deny-ui",
      effect: "deny" as const,
      capability: "ui.inspect" as const,
      scope: "persistent" as const,
    };
    const denied = await executeKiroObserveDesktop({
      toolCallId: "call-8",
      toolInput: { includeUiTree: true },
      snapshot: snapshot(),
      liveWorkspaces: [WORKSPACE],
      livePermissionRules: [denyUi],
      counters: counters(),
      oneShotApprovals: [],
      taskId: "task-1",
      readLimitPerTurn: READ_LIMIT,
    });
    expect(denied).toMatchObject({ kind: "completed", output: { ok: false, code: "PERMISSION_DENIED" } });

    const allowed = await executeKiroObserveDesktop({
      toolCallId: "call-9",
      toolInput: { includeUiTree: false },
      snapshot: snapshot(),
      liveWorkspaces: [WORKSPACE],
      livePermissionRules: [denyUi],
      counters: counters(),
      oneShotApprovals: [],
      taskId: "task-1",
      readLimitPerTurn: READ_LIMIT,
    });
    expect(allowed.kind).toBe("completed");
    if (allowed.kind === "completed") expect(allowed.output.ok).toBe(true);
  });

  it("ask rule → approval-required；one-shot 批准后可执行", async () => {
    const { observe } = installBridge();
    const askRule = {
      id: "ask-observe",
      effect: "ask" as const,
      capability: "screen.observe" as const,
      scope: "persistent" as const,
    };
    const pending = await executeKiroObserveDesktop({
      toolCallId: "call-10",
      toolInput: {},
      snapshot: snapshot(),
      liveWorkspaces: [WORKSPACE],
      livePermissionRules: [askRule],
      counters: counters(),
      oneShotApprovals: [],
      taskId: "task-1",
      readLimitPerTurn: READ_LIMIT,
    });
    expect(pending.kind).toBe("approval-required");
    expect(observe).not.toHaveBeenCalled();

    const countersAfterAsk = counters();
    const resumed = await executeKiroObserveDesktop({
      toolCallId: "call-10",
      toolInput: {},
      snapshot: snapshot(),
      liveWorkspaces: [WORKSPACE],
      livePermissionRules: [askRule],
      counters: countersAfterAsk,
      oneShotApprovals: [
        {
          approvalId: "approval-1",
          toolCallId: "call-10",
          capability: "screen.observe",
          workspaceId: "ws-1",
        },
      ],
      taskId: "task-1",
      readLimitPerTurn: READ_LIMIT,
    });
    expect(resumed.kind).toBe("completed");
    expect(observe).toHaveBeenCalledTimes(1);
  });

  it("read 预算耗尽 → PERMISSION_DENIED（不调用 Bridge）", async () => {
    const { observe } = installBridge();
    const attempt = await executeKiroObserveDesktop({
      toolCallId: "call-11",
      toolInput: {},
      snapshot: snapshot(),
      liveWorkspaces: [WORKSPACE],
      livePermissionRules: [],
      counters: { readCount: READ_LIMIT, mutationCount: 0, terminalCount: 0 },
      oneShotApprovals: [],
      taskId: "task-1",
      readLimitPerTurn: READ_LIMIT,
    });
    expect(attempt).toMatchObject({ kind: "completed", output: { ok: false, code: "PERMISSION_DENIED" } });
    expect(observe).not.toHaveBeenCalled();
  });
});

describe("executeKiroObserveDesktop — malformed 输入 / Bridge 失败", () => {
  it.each([
    { windowId: "12345" },
    { windowId: "win-abc/../x" },
    { target: "all-windows" },
    { includeScreenshot: "yes" },
    { extra: true },
  ])("非法输入 %j → INVALID_INPUT", async (toolInput) => {
    installBridge();
    const attempt = await executeKiroObserveDesktop({
      toolCallId: "call-12",
      toolInput,
      snapshot: snapshot(),
      liveWorkspaces: [WORKSPACE],
      livePermissionRules: [],
      counters: counters(),
      oneShotApprovals: [],
      taskId: "task-1",
      readLimitPerTurn: READ_LIMIT,
    });
    expect(attempt).toMatchObject({ kind: "completed", output: { ok: false, code: "INVALID_INPUT" } });
  });

  it("Bridge 失败 → 结构化 code（不透传 raw error）", async () => {
    installBridge({
      observe: async () => {
        throw { code: "RUNTIME_UNAVAILABLE", message: "桌面运行时不可用" };
      },
    });
    const attempt = await executeKiroObserveDesktop({
      toolCallId: "call-13",
      toolInput: {},
      snapshot: snapshot(),
      liveWorkspaces: [WORKSPACE],
      livePermissionRules: [],
      counters: counters(),
      oneShotApprovals: [],
      taskId: "task-1",
      readLimitPerTurn: READ_LIMIT,
    });
    expect(attempt).toMatchObject({
      kind: "completed",
      output: { ok: false, code: "RUNTIME_UNAVAILABLE" },
    });
  });
});

describe("executeKiroComputerTool 分发 — observe_desktop", () => {
  it("分发到 Desktop Observe 分支（不进入 filesystem resource pipeline）", async () => {
    installBridge();
    const attempt = await executeKiroComputerTool({
      toolName: OBSERVE_DESKTOP_TOOL_NAME,
      toolCallId: "call-14",
      toolInput: { target: "screen" },
      context: {
        turnSnapshot: snapshot(),
        liveWorkspaces: [WORKSPACE],
        livePermissionRules: [],
        taskId: "task-1",
      },
      counters: counters(),
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(true);
  });
});
