// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { executeKiroDesktopAction } from "@/lib/ai/computer/gui/executor";
import { executeKiroComputerTool } from "@/lib/ai/computer/executor";
import { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import { KiroWorkspaceMeta } from "@/lib/ai/computer/types";
import type {
  ClassFlowDesktopComputerActionPreparation,
  ClassFlowDesktopComputerActionResult,
  ClassFlowDesktopComputerObservation,
} from "@/lib/desktop/types";

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
    desktopActionEnabled: true,
    desktopActionAvailable: true,
    desktopSessionId: "cs-11111111-2222-3333-4444-555555555555",
    ...overrides,
  };
}

function preparation(
  overrides: Partial<ClassFlowDesktopComputerActionPreparation> = {}
): ClassFlowDesktopComputerActionPreparation {
  return {
    action: "click",
    risk: { level: "normal", reason: "普通 GUI 操作" },
    target: {
      kind: "element",
      elementId: "el-3",
      role: "Button",
      name: "搜索",
      isPassword: false,
      appName: "chrome",
      windowTitle: "Google",
      windowId: "win-3f9a2c1b4d5e",
      targetLabel: "Button「搜索」",
    },
    observationId: "obs-11111111-2222-3333-4444-555555555555",
    textPreview: null,
    requiresObservation: true,
    ...overrides,
  };
}

function observation(): ClassFlowDesktopComputerObservation {
  return {
    observationId: "obs-22222222-3333-4444-5555-666666666666",
    target: "active-window",
    appName: "chrome",
    windowTitle: "ClassFlow - Google 搜索",
    windowId: "win-3f9a2c1b4d5e",
    viewport: { width: 1280, height: 720 },
    windows: [{ windowId: "win-3f9a2c1b4d5e", title: "Google", appName: "chrome", active: true }],
    windowsTruncated: false,
    elements: [
      {
        elementId: "el-1",
        role: "Edit",
        name: "搜索",
        enabled: true,
        focused: true,
        isPassword: false,
        bounds: { x: 10, y: 10, width: 400, height: 40 },
      },
    ],
    elementCount: 1,
    elementsTruncated: false,
    screenshot: null,
    warnings: [],
    uiTreeRevision: 3,
    capturedAt: "2026-09-21T00:00:02.000Z",
  };
}

function actionResult(
  overrides: Partial<ClassFlowDesktopComputerActionResult> = {}
): ClassFlowDesktopComputerActionResult {
  return {
    actionResult: { action: "click", method: "uia-invoke", durationMs: 120 },
    observation: observation(),
    newObservationId: "obs-22222222-3333-4444-5555-666666666666",
    changedWindow: false,
    uiChanged: true,
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
  prepareAction?: (input: unknown) => Promise<ClassFlowDesktopComputerActionPreparation>;
  action?: (input: unknown) => Promise<ClassFlowDesktopComputerActionResult>;
  cancelActions?: (input: unknown) => Promise<{ ok: boolean; cancelled: number }>;
} = {}) {
  const prepareAction = vi.fn(options.prepareAction ?? (async () => preparation()));
  const action = vi.fn(options.action ?? (async () => actionResult()));
  const cancelActions = vi.fn(options.cancelActions ?? (async () => ({ ok: true, cancelled: 1 })));
  (window as unknown as { classflowDesktop?: unknown }).classflowDesktop = {
    version: 1,
    platform: "windows",
    filesystem: filesystemStub,
    computer: { version: 2, capabilities: async () => ({}), observe: async () => ({}), prepareAction, action, cancelActions },
  };
  return { prepareAction, action, cancelActions };
}

function counters() {
  return { readCount: 0, mutationCount: 0, terminalCount: 0 };
}

const MUTATION_LIMIT = 10;

function run(input: unknown, overrides: {
  snapshot?: KiroComputerTurnSnapshot;
  counters?: ReturnType<typeof counters>;
  oneShotApprovals?: { approvalId: string; toolCallId: string; capability: "ui.interact"; workspaceId: string; fingerprint?: string }[];
  isCancelled?: () => boolean;
  toolCallId?: string;
} = {}) {
  return executeKiroDesktopAction({
    toolCallId: overrides.toolCallId ?? "call-1",
    toolInput: input,
    snapshot: overrides.snapshot ?? snapshot(),
    liveWorkspaces: [WORKSPACE],
    livePermissionRules: [],
    counters: overrides.counters ?? counters(),
    oneShotApprovals: (overrides.oneShotApprovals ?? []) as never,
    taskId: "task-1",
    mutationLimitPerTurn: MUTATION_LIMIT,
    ...(overrides.isCancelled ? { isCancelled: overrides.isCancelled } : {}),
  });
}

afterEach(() => {
  delete (window as unknown as { classflowDesktop?: unknown }).classflowDesktop;
});

describe("desktop_action — 成功链路（click / type / key / scroll / wait）", () => {
  it("click by elementId → action result + 新 observation", async () => {
    const { prepareAction, action } = installBridge();
    const c = counters();
    const attempt = await run(
      { action: "click", observationId: "obs-11111111-2222-3333-4444-555555555555", target: { elementId: "el-3" } },
      { counters: c }
    );
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(true);
    const data = attempt.output.data as Record<string, unknown>;
    expect((data.action as Record<string, unknown>).method).toBe("uia-invoke");
    expect(data.observationId).toBe("obs-22222222-3333-4444-5555-666666666666");
    expect(data.changedWindow).toBe(false);
    expect(data.uiChanged).toBe(true);
    expect(data.verification).toBe("re-observed");
    expect(data.readOnly).toBe(false);
    expect(prepareAction).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledTimes(1);
    expect(c.mutationCount).toBe(1);
  });

  it("type → prepare/action 收到 text；执行后返回新 observation", async () => {
    const { prepareAction, action } = installBridge({
      prepareAction: async () =>
        preparation({ action: "type", textPreview: "ClassFlow" }),
      action: async () => actionResult({ actionResult: { action: "type", method: "uia-setvalue", durationMs: 90 } }),
    });
    const attempt = await run({
      action: "type",
      observationId: "obs-11111111-2222-3333-4444-555555555555",
      target: { elementId: "el-3" },
      text: "ClassFlow",
    });
    if (attempt.kind !== "completed" || !attempt.output.ok) throw new Error("expected ok");
    const data = attempt.output.data as Record<string, unknown>;
    expect((data.action as Record<string, unknown>).method).toBe("uia-setvalue");
    expect((data.action as Record<string, unknown>).type).toBe("type");
    expect(prepareAction.mock.calls[0][0]).toMatchObject({
      action: "type",
      text: "ClassFlow",
      sessionId: "cs-11111111-2222-3333-4444-555555555555",
    });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("key（enter）→ sendinput-key", async () => {
    const { action } = installBridge({
      prepareAction: async () => preparation({ action: "key" }),
      action: async () => actionResult({ actionResult: { action: "key", method: "sendinput-key", durationMs: 40 } }),
    });
    const attempt = await run({
      action: "key",
      observationId: "obs-11111111-2222-3333-4444-555555555555",
      key: "enter",
    });
    if (attempt.kind !== "completed" || !attempt.output.ok) throw new Error("expected ok");
    expect(((attempt.output.data as Record<string, unknown>).action as Record<string, unknown>).method).toBe(
      "sendinput-key"
    );
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("scroll → 无需 target；执行并返回 observation", async () => {
    installBridge({
      prepareAction: async () =>
        preparation({ action: "scroll", target: { ...preparation().target, kind: "none", targetLabel: "当前窗口" } }),
      action: async () => actionResult({ actionResult: { action: "scroll", method: "scroll", durationMs: 50 } }),
    });
    const attempt = await run({
      action: "scroll",
      observationId: "obs-11111111-2222-3333-4444-555555555555",
      scroll: -3,
    });
    if (attempt.kind !== "completed" || !attempt.output.ok) throw new Error("expected ok");
    expect(((attempt.output.data as Record<string, unknown>).action as Record<string, unknown>).type).toBe("scroll");
  });

  it("wait → 无需 observation / 不触发审批；不调用 prepareAction", async () => {
    const { prepareAction, action } = installBridge({
      action: async () => actionResult({ actionResult: { action: "wait", method: "wait", durationMs: 300 } }),
    });
    const attempt = await run({ action: "wait", wait: 300 }, { snapshot: snapshot({ agentMode: "guided" }) });
    if (attempt.kind !== "completed" || !attempt.output.ok) throw new Error("expected ok");
    const data = attempt.output.data as Record<string, unknown>;
    expect(data.observationId).toBeNull();
    expect((data.action as Record<string, unknown>).method).toBe("wait");
    expect(prepareAction).not.toHaveBeenCalled();
    // wait 直接交给 Main（无 GUI 输入；Main 只做 session 校验 + sleep）
    expect(action).toHaveBeenCalledTimes(1);
  });
});

describe("desktop_action — stale observation / 元素 / 窗口", () => {
  it("bridge STALE_OBSERVATION（prepared 阶段）→ 原样返回 stale code", async () => {
    const { action } = installBridge({
      prepareAction: async () => {
        throw { code: "STALE_OBSERVATION", message: "观察已过期" };
      },
    });
    const attempt = await run({
      action: "click",
      observationId: "obs-11111111-2222-3333-4444-555555555555",
      target: { elementId: "el-3" },
    });
    expect(attempt).toMatchObject({ kind: "completed", output: { ok: false, code: "STALE_OBSERVATION" } });
    expect(action).not.toHaveBeenCalled();
  });

  it("action 阶段 stale（元素消失 / 窗口切换）→ STALE_OBSERVATION，不消耗预算", async () => {
    const { action } = installBridge({
      action: async () => {
        throw { code: "STALE_OBSERVATION", message: "界面已变化" };
      },
    });
    const c = counters();
    const attempt = await run(
      { action: "click", observationId: "obs-11111111-2222-3333-4444-555555555555", target: { elementId: "el-3" } },
      { counters: c }
    );
    expect(attempt).toMatchObject({ kind: "completed", output: { ok: false, code: "STALE_OBSERVATION" } });
    expect(c.mutationCount).toBe(0);
    expect(action).toHaveBeenCalledTimes(1);
  });
});

describe("desktop_action — 审批", () => {
  it("Guided + 普通动作（policy ask）→ approval-required（默认决策）", async () => {
    const { action } = installBridge();
    const attempt = await run(
      { action: "click", observationId: "obs-11111111-2222-3333-4444-555555555555", target: { elementId: "el-3" } },
      { snapshot: snapshot({ agentMode: "guided" }) }
    );
    expect(attempt.kind).toBe("approval-required");
    if (attempt.kind !== "approval-required") return;
    expect(attempt.request.capability).toBe("ui.interact");
    expect(attempt.request.allowedDecisions).toContain("allow-session");
    expect(attempt.request.gui?.riskLevel).toBe("normal");
    expect(action).not.toHaveBeenCalled();
  });

  it("Workspace Auto + 高风险（发送）→ 强制审批且只允许 deny / allow-once", async () => {
    installBridge({
      prepareAction: async () =>
        preparation({
          risk: { level: "external", reason: "目标「发送」可能产生外部效果" },
          target: { ...preparation().target, name: "发送" },
        }),
    });
    const attempt = await run({
      action: "click",
      observationId: "obs-11111111-2222-3333-4444-555555555555",
      target: { elementId: "el-3" },
    });
    expect(attempt.kind).toBe("approval-required");
    if (attempt.kind !== "approval-required") return;
    expect(attempt.request.allowedDecisions).toEqual(["deny", "allow-once"]);
    expect(attempt.request.gui?.riskLevel).toBe("external");
    expect(attempt.request.gui?.targetLabel).toContain("Button");
  });

  it("高风险 one-shot 批准后执行（fingerprint 精确匹配）", async () => {
    const { action } = installBridge({
      prepareAction: async () =>
        preparation({ risk: { level: "destructive", reason: "删除" }, target: { ...preparation().target, name: "删除" } }),
    });
    const fingerprint = "gui:click:element:el-3";
    const attempt = await run(
      { action: "click", observationId: "obs-11111111-2222-3333-4444-555555555555", target: { elementId: "el-3" } },
      {
        oneShotApprovals: [
          { approvalId: "a-1", toolCallId: "call-1", capability: "ui.interact", workspaceId: "ws-1", fingerprint },
        ],
      }
    );
    expect(attempt.kind).toBe("completed");
    if (attempt.kind === "completed") expect(attempt.output.ok).toBe(true);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("敏感文本（Main blocked）→ ACTION_BLOCKED，且绝不调用 action", async () => {
    const { action } = installBridge({
      prepareAction: async () =>
        preparation({
          action: "type",
          risk: { level: "blocked", reason: "检测到疑似密码 / API Key / Token，禁止经模型输入" },
        }),
    });
    const attempt = await run({
      action: "type",
      observationId: "obs-11111111-2222-3333-4444-555555555555",
      target: { elementId: "el-3" },
      text: "api_key=abcdef",
    });
    expect(attempt).toMatchObject({ kind: "completed", output: { ok: false, code: "ACTION_BLOCKED" } });
    expect(action).not.toHaveBeenCalled();
  });

  it("blocked 按键（ctrl+c）→ schema 层 INVALID_INPUT；不触达 bridge", async () => {
    const { prepareAction, action } = installBridge();
    const attempt = await run({
      action: "key",
      observationId: "obs-11111111-2222-3333-4444-555555555555",
      key: "ctrl+c",
    });
    expect(attempt).toMatchObject({ kind: "completed", output: { ok: false, code: "INVALID_INPUT" } });
    expect(prepareAction).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
  });
});

describe("desktop_action — 门禁 / 输入 / Stop", () => {
  it("desktopActionEnabled=false → PERMISSION_DENIED（不调用 bridge）", async () => {
    const { prepareAction } = installBridge();
    const attempt = await run(
      { action: "click", observationId: "obs-11111111-2222-3333-4444-555555555555", target: { elementId: "el-3" } },
      { snapshot: snapshot({ desktopActionEnabled: false }) }
    );
    expect(attempt).toMatchObject({ kind: "completed", output: { ok: false, code: "PERMISSION_DENIED" } });
    expect(prepareAction).not.toHaveBeenCalled();
  });

  it("desktopActionAvailable=false（Web / v1）→ PERMISSION_DENIED", async () => {
    installBridge();
    const attempt = await run(
      { action: "click", observationId: "obs-11111111-2222-3333-4444-555555555555", target: { elementId: "el-3" } },
      { snapshot: snapshot({ desktopActionAvailable: false }) }
    );
    expect(attempt).toMatchObject({ kind: "completed", output: { ok: false, code: "PERMISSION_DENIED" } });
  });

  it("无 Action Bridge（Web runtime）→ PERMISSION_DENIED", async () => {
    const attempt = await run({
      action: "click",
      observationId: "obs-11111111-2222-3333-4444-555555555555",
      target: { elementId: "el-3" },
    });
    expect(attempt).toMatchObject({ kind: "completed", output: { ok: false, code: "PERMISSION_DENIED" } });
  });

  it("Plan 模式 → PERMISSION_DENIED（只读）", async () => {
    installBridge();
    const attempt = await run(
      { action: "click", observationId: "obs-11111111-2222-3333-4444-555555555555", target: { elementId: "el-3" } },
      { snapshot: snapshot({ agentMode: "plan" }) }
    );
    expect(attempt).toMatchObject({ kind: "completed", output: { ok: false, code: "PERMISSION_DENIED" } });
  });

  it.each([
    ["缺 observationId", { action: "click", target: { elementId: "el-3" } }],
    ["物理像素坐标", { action: "click", observationId: "obs-1", target: { normalized: { x: 300, y: 400 } } }],
    ["非法 elementId", { action: "click", observationId: "obs-1", target: { elementId: "button-3" } }],
    ["focus 用坐标", { action: "focus", observationId: "obs-1", target: { normalized: { x: 0.5, y: 0.5 } } }],
    ["type 缺 text", { action: "type", observationId: "obs-1", target: { elementId: "el-3" } }],
    ["跨动作夹带", { action: "click", observationId: "obs-1", target: { elementId: "el-3" }, text: "x" }],
    ["未知字段", { action: "scroll", observationId: "obs-1", scroll: -1, hwnd: 42 }],
    ["scroll=0", { action: "scroll", observationId: "obs-1", scroll: 0 }],
  ])("malformed 输入（%s）→ INVALID_INPUT", async (_label, toolInput) => {
    installBridge();
    const attempt = await run(toolInput);
    expect(attempt).toMatchObject({ kind: "completed", output: { ok: false, code: "INVALID_INPUT" } });
  });

  it("mutation 预算耗尽 → PERMISSION_DENIED", async () => {
    const { prepareAction } = installBridge();
    const attempt = await run(
      { action: "click", observationId: "obs-11111111-2222-3333-4444-555555555555", target: { elementId: "el-3" } },
      { counters: { readCount: 0, mutationCount: MUTATION_LIMIT, terminalCount: 0 } }
    );
    expect(attempt).toMatchObject({ kind: "completed", output: { ok: false, code: "PERMISSION_DENIED" } });
    expect(prepareAction).not.toHaveBeenCalled();
  });

  it("Stop（isCancelled）→ CANCELLED 且不调用 bridge", async () => {
    const { prepareAction, action } = installBridge();
    const attempt = await run(
      { action: "click", observationId: "obs-11111111-2222-3333-4444-555555555555", target: { elementId: "el-3" } },
      { isCancelled: () => true }
    );
    expect(attempt).toMatchObject({ kind: "completed", output: { ok: false, code: "CANCELLED" } });
    expect(prepareAction).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
  });

  it("Main 返回 CANCELLED（Stop 竞态）→ CANCELLED", async () => {
    installBridge({
      prepareAction: async () => {
        throw { code: "CANCELLED", message: "用户已停止电脑操作。" };
      },
    });
    const attempt = await run({
      action: "click",
      observationId: "obs-11111111-2222-3333-4444-555555555555",
      target: { elementId: "el-3" },
    });
    expect(attempt).toMatchObject({ kind: "completed", output: { ok: false, code: "CANCELLED" } });
  });
});

describe("executeKiroComputerTool 分发 — desktop_action", () => {
  it("分发到 GUI executor（不进入 filesystem pipeline）", async () => {
    installBridge();
    const attempt = await executeKiroComputerTool({
      toolName: "desktop_action",
      toolCallId: "call-9",
      toolInput: {
        action: "click",
        observationId: "obs-11111111-2222-3333-4444-555555555555",
        target: { elementId: "el-3" },
      },
      context: {
        turnSnapshot: snapshot(),
        liveWorkspaces: [WORKSPACE],
        livePermissionRules: [],
        taskId: "task-1",
      },
      counters: counters(),
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind === "completed") expect(attempt.output.ok).toBe(true);
  });
});
