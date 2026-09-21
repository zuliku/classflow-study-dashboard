// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { executeKiroComputerTool } from "@/lib/ai/computer/executor";
import { getKiroToolsForRequest } from "@/lib/ai/tools";
import { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import { KiroWorkspaceMeta } from "@/lib/ai/computer/types";
import { useDesktopSessionStore } from "@/store/useDesktopSessionStore";
import {
  FakeDesktopWorld,
  installFakeDesktopBridge,
  type FakeElement,
} from "@/tests/helpers/fakeDesktopRuntime";

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

function makeSearchWorld(): FakeDesktopWorld {
  const search: FakeElement = {
    elementId: "el-1",
    role: "Edit",
    name: "搜索",
    bounds: { x: 200, y: 80, width: 500, height: 40 },
  };
  const world = new FakeDesktopWorld([
    { windowId: "win-chrome", title: "新标签页 - Google Chrome", appName: "chrome", elements: [search] },
  ]);
  world.onEnter = (w) => {
    const window = w.getActiveWindow();
    if (!window) return;
    if (w.typedText && !window.elements.some((e) => e.name === "搜索结果")) {
      window.title = `${w.typedText} - Google 搜索`;
      window.elements = [
        search,
        { elementId: "el-2", role: "Pane", name: "搜索结果", bounds: { x: 200, y: 140, width: 700, height: 500 } },
      ];
    }
  };
  return world;
}

interface ToolRunOptions {
  snapshot?: KiroComputerTurnSnapshot;
  toolCallId?: string;
  counters?: { readCount: number; mutationCount: number; terminalCount: number };
  oneShotApprovals?: Array<{
    approvalId: string;
    toolCallId: string;
    capability: string;
    workspaceId: string;
    fingerprint?: string;
  }>;
  isCancelled?: () => boolean;
  desktopVision?: { enabled: boolean; model: string; apiKey?: string };
  desktopVisionDeps?: {
    generateText?: (options: unknown) => Promise<{ text: string }>;
    resolveModel?: (options: unknown) => Promise<{ model: unknown }>;
  };
}

let callSeq = 0;
function runTool(
  toolName: string,
  toolInput: unknown,
  options: ToolRunOptions = {}
) {
  callSeq += 1;
  const toolCallId = options.toolCallId ?? `call-${callSeq}`;
  return executeKiroComputerTool({
    toolName,
    toolCallId,
    toolInput,
    context: {
      turnSnapshot: options.snapshot ?? snapshot(),
      liveWorkspaces: [WORKSPACE],
      livePermissionRules: [],
      taskId: "task-1",
      ...(options.isCancelled ? { isCancelled: options.isCancelled } : {}),
      ...(options.desktopVision ? { desktopVision: options.desktopVision } : {}),
      ...(options.desktopVisionDeps ? { desktopVisionDeps: options.desktopVisionDeps as never } : {}),
    },
    counters: options.counters ?? { readCount: 0, mutationCount: 0, terminalCount: 0 },
    oneShotApprovals: (options.oneShotApprovals ?? []) as never,
  });
}

function dataOf(attempt: Awaited<ReturnType<typeof executeKiroComputerTool>>): Record<string, unknown> {
  if (attempt.kind !== "completed" || !attempt.output.ok) {
    throw new Error(`expected ok output, got ${JSON.stringify(attempt)}`);
  }
  return attempt.output.data as Record<string, unknown>;
}

afterEach(() => {
  delete (window as unknown as { classflowDesktop?: unknown }).classflowDesktop;
  useDesktopSessionStore.getState().clear();
});

describe("Phase 3 integration — 1. 多步骤网页搜索（open → observe → click → type → enter → observe）", () => {
  it("自主完成搜索并返回结果 observation", async () => {
    const world = makeSearchWorld();
    installFakeDesktopBridge(world);
    const counters = { readCount: 0, mutationCount: 0, terminalCount: 0 };

    const opened = dataOf(
      await runTool("open_application", { app: "chrome" }, { counters })
    );
    expect(opened.launched).toBe(true);
    expect(world.launchedApps).toContain("chrome");

    const observation = dataOf(await runTool("observe_desktop", {}, { counters }));
    const search = (observation.elements as Array<{ elementId: string; name: string }>).find(
      (e) => e.name === "搜索"
    )!;
    expect(search).toBeTruthy();

    const clicked = dataOf(
      await runTool(
        "desktop_action",
        { action: "click", observationId: observation.observationId, target: { elementId: search.elementId } },
        { counters }
      )
    );
    const afterClick = clicked.observationId as string;

    const typed = dataOf(
      await runTool(
        "desktop_action",
        { action: "type", observationId: afterClick, target: { elementId: search.elementId }, text: "ClassFlow" },
        { counters }
      )
    );
    const afterType = typed.observationId as string;

    const submitted = dataOf(
      await runTool("desktop_action", { action: "key", observationId: afterType, key: "enter" }, { counters })
    );
    const afterEnter = submitted.observationId as string;
    expect(submitted.uiChanged).toBe(true);

    const results = dataOf(
      await runTool("observe_desktop", {}, { counters })
    );
    const elements = results.elements as Array<{ name: string }>;
    expect(elements.some((e) => e.name === "搜索结果")).toBe(true);
    expect(results.windowTitle).toContain("ClassFlow");
    expect(afterEnter).toBeTruthy();
  });
});

describe("Phase 3 integration — 2. 窗口切换（list → activate → observe）", () => {
  it("切换活动窗口后观察目标应用", async () => {
    const world = new FakeDesktopWorld([
      { windowId: "win-chrome", title: "Google", appName: "chrome", elements: [] },
      {
        windowId: "win-wechat",
        title: "微信",
        appName: "wechat",
        elements: [{ elementId: "el-10", role: "Button", name: "文件传输助手", bounds: { x: 10, y: 10, width: 200, height: 40 } }],
      },
    ]);
    installFakeDesktopBridge(world);
    const counters = { readCount: 0, mutationCount: 0, terminalCount: 0 };

    const list = dataOf(await runTool("list_desktop_windows", {}, { counters }));
    expect(list.activeApplication).toBe("chrome");
    const wechat = (list.windows as Array<{ windowId: string; appName: string }>).find(
      (w) => w.appName === "wechat"
    )!;

    const activated = dataOf(
      await runTool("activate_window", { windowId: wechat.windowId }, { counters })
    );
    expect(activated.activated).toBe(true);

    const observation = dataOf(await runTool("observe_desktop", {}, { counters }));
    expect(observation.appName).toBe("wechat");
    expect((observation.elements as Array<{ name: string }>).some((e) => e.name === "文件传输助手")).toBe(true);
  });
});

describe("Phase 3 integration — 3. stale observation recovery", () => {
  it("界面变化 → STALE_OBSERVATION；重新 observe 后可继续", async () => {
    const world = new FakeDesktopWorld([
      {
        windowId: "win-chrome",
        title: "Google",
        appName: "chrome",
        elements: [{ elementId: "el-1", role: "Button", name: "搜索", bounds: { x: 1, y: 1, width: 100, height: 30 } }],
      },
    ]);
    installFakeDesktopBridge(world);
    const counters = { readCount: 0, mutationCount: 0, terminalCount: 0 };
    const first = dataOf(await runTool("observe_desktop", {}, { counters }));
    const element = (first.elements as Array<{ elementId: string }>)[0];

    world.markStale("win-chrome");
    const stale = await runTool(
      "desktop_action",
      { action: "click", observationId: first.observationId, target: { elementId: element.elementId } },
      { counters }
    );
    expect(stale).toMatchObject({ kind: "completed", output: { ok: false, code: "STALE_OBSERVATION" } });

    // 重新观察（清除 stale）→ 可以继续
    const fresh = dataOf(await runTool("observe_desktop", {}, { counters }));
    const freshElement = (fresh.elements as Array<{ elementId: string }>)[0];
    const retried = await runTool(
      "desktop_action",
      { action: "click", observationId: fresh.observationId, target: { elementId: freshElement.elementId } },
      { counters }
    );
    expect(retried.kind).toBe("completed");
    if (retried.kind === "completed") expect(retried.output.ok).toBe(true);
  });
});

describe("Phase 3 integration — 4. UIA 空 → Vision fallback（候选区域，不直接执行）", () => {
  it("UIA 树为空时返回 vision candidates（归一化坐标）", async () => {
    const world = new FakeDesktopWorld([
      { windowId: "win-canvas", title: "Canvas App", appName: "chrome", elements: [] },
    ]);
    world.setVisionCandidates([
      { label: "开始按钮", confidence: 0.9, bounds: { x: 0.1, y: 0.2, width: 0.2, height: 0.1 } },
    ]);
    installFakeDesktopBridge(world);
    const counters = { readCount: 0, mutationCount: 0, terminalCount: 0 };

    const result = dataOf(
      await runTool("observe_desktop", { includeVision: true, visionGoal: "找到开始按钮" }, {
        counters,
        desktopVision: { enabled: true, model: "mimo-v2.5", apiKey: "test-key" },
        desktopVisionDeps: {
          resolveModel: async () => ({ model: {} }),
          generateText: async () => ({
            text: JSON.stringify([
              { label: "开始按钮", confidence: 0.9, bounds: { x: 0.1, y: 0.2, width: 0.2, height: 0.1 } },
            ]),
          }),
        } as never,
      })
    );
    const vision = result.visionFallback as {
      available: boolean;
      candidates: Array<{ label: string; bounds: { x: number } }>;
    };
    expect(vision.available).toBe(true);
    expect(vision.candidates[0].label).toBe("开始按钮");

    // vision candidate 只能作为坐标回退使用 → 高风险（external）需要确认，且不能直接执行
    const click = await runTool(
      "desktop_action",
      {
        action: "click",
        observationId: result.observationId,
        target: { normalized: { x: 0.2, y: 0.25 } },
      },
      { counters }
    );
    expect(click.kind).toBe("approval-required");
  });
});

describe("Phase 3 integration — 5. 用户中途 Stop", () => {
  it("Stop 后不再执行 GUI 动作（CANCELLED）", async () => {
    const world = makeSearchWorld();
    installFakeDesktopBridge(world);
    const counters = { readCount: 0, mutationCount: 0, terminalCount: 0 };
    const observation = dataOf(await runTool("observe_desktop", {}, { counters }));

    let stopped = false;
    const first = await runTool(
      "desktop_action",
      {
        action: "click",
        observationId: observation.observationId,
        target: { elementId: (observation.elements as Array<{ elementId: string }>)[0].elementId },
      },
      { counters, isCancelled: () => stopped }
    );
    expect(first.kind).toBe("completed");

    stopped = true;
    const second = await runTool("observe_desktop", {}, { counters, isCancelled: () => stopped });
    expect(second).toMatchObject({ kind: "completed", output: { ok: false, code: "CANCELLED" } });
  });
});

describe("Phase 3 integration — 6. approval pause / resume", () => {
  it("Guided 普通动作 → approval-required；allow-once 后执行", async () => {
    const world = makeSearchWorld();
    installFakeDesktopBridge(world);
    const counters = { readCount: 0, mutationCount: 0, terminalCount: 0 };
    const guided = snapshot({ agentMode: "guided" });
    const observation = dataOf(await runTool("observe_desktop", {}, { counters, snapshot: guided }));
    const element = (observation.elements as Array<{ elementId: string }>)[0];
    const input = {
      action: "click",
      observationId: observation.observationId,
      target: { elementId: element.elementId },
    };
    const toolCallId = "call-approval-resume";
    const pending = await runTool("desktop_action", input, { counters, snapshot: guided, toolCallId });
    expect(pending.kind).toBe("approval-required");
    if (pending.kind !== "approval-required") return;
    expect(pending.request.capability).toBe("ui.interact");

    const resumed = await runTool("desktop_action", input, {
      counters,
      snapshot: guided,
      toolCallId,
      oneShotApprovals: [
        {
          approvalId: pending.request.id,
          toolCallId: pending.request.toolCallId,
          capability: "ui.interact",
          workspaceId: "ws-1",
          fingerprint: pending.request.fingerprint,
        },
      ],
    });
    expect(resumed.kind).toBe("completed");
    if (resumed.kind === "completed") expect(resumed.output.ok).toBe(true);
  });
});

describe("Phase 3 integration — 7. no-progress detection", () => {
  it("连续无 UI 变化的动作 → NO_PROGRESS（停止自动尝试）", async () => {
    const world = new FakeDesktopWorld([
      {
        windowId: "win-chrome",
        title: "Google",
        appName: "chrome",
        elements: [{ elementId: "el-1", role: "Edit", name: "搜索", bounds: { x: 1, y: 1, width: 100, height: 30 } }],
      },
    ]);
    installFakeDesktopBridge(world);
    const counters = { readCount: 0, mutationCount: 0, terminalCount: 0 };
    const observation = dataOf(await runTool("observe_desktop", {}, { counters }));
    const codes: string[] = [];
    for (let i = 0; i < 6; i++) {
      const attempt = await runTool(
        "desktop_action",
        { action: "scroll", observationId: observation.observationId, scroll: i % 2 === 0 ? -3 : 3 },
        { counters }
      );
      if (attempt.kind === "completed" && !attempt.output.ok) {
        codes.push(attempt.output.code);
        break;
      }
    }
    expect(codes).toContain("NO_PROGRESS");
  });
});

describe("Phase 3 integration — 8. sensitive-input block", () => {
  it("密码字段输入被阻止（ACTION_BLOCKED；不调用 action）", async () => {
    const world = new FakeDesktopWorld([
      {
        windowId: "win-login",
        title: "登录",
        appName: "chrome",
        elements: [
          {
            elementId: "el-1",
            role: "Edit",
            name: "密码",
            isPassword: true,
            bounds: { x: 1, y: 1, width: 200, height: 30 },
          },
        ],
      },
    ]);
    installFakeDesktopBridge(world);
    const counters = { readCount: 0, mutationCount: 0, terminalCount: 0 };
    const observation = dataOf(await runTool("observe_desktop", {}, { counters }));
    const attempt = await runTool(
      "desktop_action",
      {
        action: "type",
        observationId: observation.observationId,
        target: { elementId: "el-1" },
        text: "my-secret-password",
      },
      { counters }
    );
    expect(attempt).toMatchObject({ kind: "completed", output: { ok: false, code: "ACTION_BLOCKED" } });
    expect(world.log.some((entry) => entry.tool === "action")).toBe(false);
  });
});

describe("Phase 3 integration — 9. app.open policy", () => {
  it("Guided → 打开应用需要审批；批准后启动", async () => {
    const world = makeSearchWorld();
    installFakeDesktopBridge(world);
    const counters = { readCount: 0, mutationCount: 0, terminalCount: 0 };
    const guided = snapshot({ agentMode: "guided" });
    const toolCallId = "call-app-open";
    const pending = await runTool("open_application", { app: "chrome" }, { counters, snapshot: guided, toolCallId });
    expect(pending.kind).toBe("approval-required");
    if (pending.kind !== "approval-required") return;
    expect(pending.request.capability).toBe("app.open");

    const resumed = await runTool("open_application", { app: "chrome" }, {
      counters,
      snapshot: guided,
      toolCallId,
      oneShotApprovals: [
        {
          approvalId: pending.request.id,
          toolCallId: pending.request.toolCallId,
          capability: "app.open",
          workspaceId: "ws-1",
          fingerprint: pending.request.fingerprint,
        },
      ],
    });
    expect(resumed.kind).toBe("completed");
    if (resumed.kind === "completed") expect(resumed.output.ok).toBe(true);
    expect(world.launchedApps).toContain("chrome");
  });

  it("Plan 模式不暴露 desktop_action / activate_window / open_application（只暴露 list）", () => {
    const set = getKiroToolsForRequest({
      computerSnapshot: {
        enabled: true,
        agentMode: "plan",
        desktopControlEnabled: true,
        desktopControlAvailable: true,
        desktopActionEnabled: true,
        desktopActionAvailable: true,
      },
    });
    expect(set).toHaveProperty("list_desktop_windows");
    expect(set).not.toHaveProperty("desktop_action");
    expect(set).not.toHaveProperty("activate_window");
    expect(set).not.toHaveProperty("open_application");
  });

  it("Web runtime（无 session bridge）→ 全部 desktop 工具不暴露", () => {
    const set = getKiroToolsForRequest({
      computerSnapshot: {
        enabled: true,
        agentMode: "workspace-auto",
        desktopControlEnabled: true,
        desktopControlAvailable: false,
        desktopActionEnabled: true,
        desktopActionAvailable: false,
      },
    });
    expect(set).not.toHaveProperty("list_desktop_windows");
    expect(set).not.toHaveProperty("observe_desktop");
    expect(set).not.toHaveProperty("open_application");
  });

  it("ready → 全部 6 个 desktop 工具暴露（observe/action/窗口/应用）", () => {
    const set = getKiroToolsForRequest({
      computerSnapshot: {
        enabled: true,
        agentMode: "workspace-auto",
        desktopControlEnabled: true,
        desktopControlAvailable: true,
        desktopActionEnabled: true,
        desktopActionAvailable: true,
      },
    });
    for (const tool of [
      "observe_desktop",
      "desktop_action",
      "list_desktop_windows",
      "activate_window",
      "open_application",
    ]) {
      expect(set, tool).toHaveProperty(tool);
    }
  });

  it("desktopActionEnabled=false → 仅 observe / list 暴露", () => {
    const set = getKiroToolsForRequest({
      computerSnapshot: {
        enabled: true,
        agentMode: "workspace-auto",
        desktopControlEnabled: true,
        desktopControlAvailable: true,
        desktopActionEnabled: false,
        desktopActionAvailable: true,
      },
    });
    expect(set).toHaveProperty("observe_desktop");
    expect(set).toHaveProperty("list_desktop_windows");
    expect(set).not.toHaveProperty("desktop_action");
    expect(set).not.toHaveProperty("activate_window");
    expect(set).not.toHaveProperty("open_application");
  });
});

describe("Phase 3 integration — 10. final external action approval（发送前逐次确认）", () => {
  it("Workspace Auto 点击「发送」→ 强制审批且仅 deny / allow-once", async () => {
    const world = new FakeDesktopWorld([
      {
        windowId: "win-wechat",
        title: "文件传输助手",
        appName: "wechat",
        elements: [
          { elementId: "el-1", role: "Button", name: "发送", bounds: { x: 500, y: 500, width: 80, height: 30 } },
        ],
      },
    ]);
    // 点击发送 → 消息进入记录（用于验证成功）
    const sendButton = world.getActiveWindow()!.elements[0];
    sendButton.onClick = (w) => {
      w.sentMessages.push("文件: 报告.docx");
      w.getActiveWindow()!.elements = [
        ...w.getActiveWindow()!.elements,
        { elementId: "el-2", role: "ListItem", name: "报告.docx 已发送", bounds: { x: 10, y: 400, width: 300, height: 24 } },
      ];
    };
    installFakeDesktopBridge(world);
    const counters = { readCount: 0, mutationCount: 0, terminalCount: 0 };
    const observation = dataOf(await runTool("observe_desktop", {}, { counters }));
    const input = {
      action: "click",
      observationId: observation.observationId,
      target: { elementId: "el-1" },
    };
    const toolCallId = "call-final-send";
    const pending = await runTool("desktop_action", input, { counters, toolCallId });
    expect(pending.kind).toBe("approval-required");
    if (pending.kind !== "approval-required") return;
    expect(pending.request.allowedDecisions).toEqual(["deny", "allow-once"]);
    expect(pending.request.gui?.riskLevel).toBe("external");

    const approved = await runTool("desktop_action", input, {
      counters,
      toolCallId,
      oneShotApprovals: [
        {
          approvalId: pending.request.id,
          toolCallId: pending.request.toolCallId,
          capability: "ui.interact",
          workspaceId: "ws-1",
          fingerprint: pending.request.fingerprint,
        },
      ],
    });
    expect(approved.kind).toBe("completed");
    if (approved.kind !== "completed" || !approved.output.ok) throw new Error("expected ok");
    // 验证：消息出现在记录中（不能只以“点击成功”为依据）
    expect(world.sentMessages).toHaveLength(1);
    const data = approved.output.data as { observation: { elements: Array<{ name: string }> } };
    expect(data.observation.elements.some((e) => e.name.includes("已发送"))).toBe(true);
  });
});

describe("Phase 3 — Sidecar Session Store", () => {
  it("session 事件 → UI 状态；clear 重置", () => {
    useDesktopSessionStore.getState().applyEvent({
      type: "session",
      sessionId: "cs-1",
      state: "acting",
      appName: "chrome",
      windowTitle: "Google",
      actionLabel: "type el-1",
      actions: 2,
      observations: 3,
      updatedAt: 1,
    });
    expect(useDesktopSessionStore.getState().state).toBe("acting");
    expect(useDesktopSessionStore.getState().appName).toBe("chrome");
    useDesktopSessionStore.getState().clear();
    expect(useDesktopSessionStore.getState().sessionId).toBeNull();
  });
});
