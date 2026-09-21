// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { executeKiroComputerTool } from "@/lib/ai/computer/executor";
import { getKiroToolsForRequest } from "@/lib/ai/tools";
import { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import { KiroWorkspaceMeta } from "@/lib/ai/computer/types";
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

interface RunOptions {
  snapshot?: KiroComputerTurnSnapshot;
  counters?: { readCount: number; mutationCount: number; terminalCount: number };
  toolCallId?: string;
  desktopVision?: { enabled: boolean; model: string; apiKey?: string };
  desktopVisionDeps?: unknown;
  isCancelled?: () => boolean;
}

function runTool(toolName: string, toolInput: unknown, options: RunOptions = {}) {
  return executeKiroComputerTool({
    toolName,
    toolCallId: options.toolCallId ?? `call-${Math.random().toString(36).slice(2, 8)}`,
    toolInput,
    context: {
      turnSnapshot: options.snapshot ?? snapshot(),
      liveWorkspaces: [WORKSPACE],
      livePermissionRules: [],
      taskId: "task-1",
      ...(options.desktopVision ? { desktopVision: options.desktopVision } : {}),
      ...(options.desktopVisionDeps ? { desktopVisionDeps: options.desktopVisionDeps as never } : {}),
      ...(options.isCancelled ? { isCancelled: options.isCancelled } : {}),
    },
    counters: options.counters ?? { readCount: 0, mutationCount: 0, terminalCount: 0 },
    oneShotApprovals: [],
  });
}

function dataOf(attempt: Awaited<ReturnType<typeof executeKiroComputerTool>>): Record<string, unknown> {
  if (attempt.kind !== "completed" || !attempt.output.ok) {
    throw new Error(`expected ok output, got ${JSON.stringify(attempt)}`);
  }
  return attempt.output.data as Record<string, unknown>;
}

const SEARCH: FakeElement = {
  elementId: "el-1",
  role: "Edit",
  name: "搜索",
  bounds: { x: 200, y: 80, width: 500, height: 40 },
};
const SEND: FakeElement = {
  elementId: "el-2",
  role: "Button",
  name: "发送",
  bounds: { x: 200, y: 500, width: 80, height: 30 },
};

afterEach(() => {
  delete (window as unknown as { classflowDesktop?: unknown }).classflowDesktop;
});

describe("V2.1 find_desktop_element（执行器）", () => {
  it("在 observation 内检索并返回排序后的 elementId（只读）", async () => {
    const world = new FakeDesktopWorld([
      { windowId: "win-chrome", title: "Google", appName: "chrome", elements: [SEARCH, SEND] },
    ]);
    installFakeDesktopBridge(world);
    const counters = { readCount: 0, mutationCount: 0, terminalCount: 0 };
    const observation = dataOf(await runTool("observe_desktop", {}, { counters }));
    const result = dataOf(
      await runTool(
        "find_desktop_element",
        { observationId: observation.observationId, query: "发送" },
        { counters }
      )
    );
    expect(result.matchCount).toBe(1);
    const matches = result.matches as Array<{ elementId: string; role: string; name: string; score: number }>;
    expect(matches[0].elementId).toBe("el-2");
    expect(matches[0].role).toBe("Button");
    expect(counters.readCount).toBe(2); // observe + find
    expect(counters.mutationCount).toBe(0);
  });

  it("observationId 过期 → STALE_OBSERVATION", async () => {
    const world = new FakeDesktopWorld([
      { windowId: "win-chrome", title: "Google", appName: "chrome", elements: [SEARCH] },
    ]);
    installFakeDesktopBridge(world);
    const attempt = await runTool("find_desktop_element", {
      observationId: "obs-deadbeef-0000",
      query: "搜索",
    });
    expect(attempt).toMatchObject({ kind: "completed", output: { ok: false, code: "STALE_OBSERVATION" } });
  });

  it("desktopActionEnabled=false 时仍可用（只读观察能力）；web runtime 不可用", async () => {
    const world = new FakeDesktopWorld([
      { windowId: "win-chrome", title: "Google", appName: "chrome", elements: [SEARCH] },
    ]);
    installFakeDesktopBridge(world);
    const observation = dataOf(await runTool("observe_desktop", {}, { snapshot: snapshot() }));
    const attempt = await runTool(
      "find_desktop_element",
      { observationId: observation.observationId, query: "搜索" },
      { snapshot: snapshot({ desktopActionEnabled: false }) }
    );
    expect(attempt.kind).toBe("completed");
    if (attempt.kind === "completed") expect(attempt.output.ok).toBe(true);

    delete (window as unknown as { classflowDesktop?: unknown }).classflowDesktop;
    const denied = await runTool("find_desktop_element", {
      observationId: observation.observationId,
      query: "搜索",
    });
    expect(denied).toMatchObject({ kind: "completed", output: { ok: false, code: "PERMISSION_DENIED" } });
  });
});

describe("V2.1 desktop_action.expect（执行器）", () => {
  it("expect 透传并在输出中返回 verification / expectationPassed", async () => {
    const world = new FakeDesktopWorld([
      { windowId: "win-chrome", title: "Google", appName: "chrome", elements: [SEARCH] },
    ]);
    const searchButton = world.getActiveWindow()!.elements[0];
    searchButton.onClick = (w) => {
      w.getActiveWindow()!.elements = [SEARCH, { ...SEND, name: "发送成功" }];
    };
    installFakeDesktopBridge(world);
    const counters = { readCount: 0, mutationCount: 0, terminalCount: 0 };
    const observation = dataOf(await runTool("observe_desktop", {}, { counters }));
    const attempt = await runTool(
      "desktop_action",
      {
        action: "click",
        observationId: observation.observationId,
        target: { elementId: "el-1" },
        expect: { elementAppears: { nameContains: "发送成功" } },
      },
      { counters }
    );
    const data = dataOf(attempt);
    expect(data.expectationPassed).toBe(true);
    const verification = data.verification as { passed: boolean; checks: Array<{ check: string }> };
    expect(verification.passed).toBe(true);
    expect(verification.checks[0].check).toBe("elementAppears");
  });

  it("expect 未满足 → expectationPassed=false（模型必须重新观察）", async () => {
    const world = new FakeDesktopWorld([
      { windowId: "win-chrome", title: "Google", appName: "chrome", elements: [SEARCH] },
    ]);
    installFakeDesktopBridge(world);
    const counters = { readCount: 0, mutationCount: 0, terminalCount: 0 };
    const observation = dataOf(await runTool("observe_desktop", {}, { counters }));
    const attempt = await runTool(
      "desktop_action",
      {
        action: "click",
        observationId: observation.observationId,
        target: { elementId: "el-1" },
        expect: { textAppears: "保存成功" },
      },
      { counters }
    );
    const data = dataOf(attempt);
    expect(data.expectationPassed).toBe(false);
  });

  it("wait 动作携带 expect → INVALID_INPUT（schema 层拒绝）", async () => {
    const world = new FakeDesktopWorld([
      { windowId: "win-chrome", title: "Google", appName: "chrome", elements: [SEARCH] },
    ]);
    installFakeDesktopBridge(world);
    const attempt = await runTool("desktop_action", {
      action: "wait",
      wait: 300,
      expect: { textAppears: "x" },
    });
    expect(attempt).toMatchObject({ kind: "completed", output: { ok: false, code: "INVALID_INPUT" } });
  });
});

describe("V2.1 vision candidate ↔ elementId 关联（执行器）", () => {
  it("候选与 UIA 元素重叠 → 输出携带 elementId；后续可直接用语义动作", async () => {
    const world = new FakeDesktopWorld([
      { windowId: "win-canvas", title: "Canvas App", appName: "chrome", elements: [SEND] },
    ]);
    installFakeDesktopBridge(world);
    const counters = { readCount: 0, mutationCount: 0, terminalCount: 0 };
    const attempt = await runTool(
      "observe_desktop",
      { includeVision: true },
      {
        counters,
        desktopVision: { enabled: true, model: "mimo-v2.5", apiKey: "test-key" },
        // 候选区域覆盖 SEND 元素（200,500,80,30 / viewport 1280x800）
        desktopVisionDeps: {
          resolveModel: async () => ({ model: {} }),
          generateText: async () => ({
            text: JSON.stringify([
              {
                label: "发送按钮",
                confidence: 0.9,
                bounds: { x: 200 / 1280, y: 500 / 800, width: 80 / 1280, height: 30 / 800 },
              },
            ]),
          }),
        },
      }
    );
    const data = dataOf(attempt);
    const vision = data.visionFallback as {
      available: boolean;
      candidates: Array<{ label: string; elementId?: string; role?: string }>;
    };
    expect(vision.available).toBe(true);
    expect(vision.candidates[0].elementId).toBe("el-2");
    expect(vision.candidates[0].role).toBe("Button");
  });
});

describe("V2.1 工具暴露", () => {
  it("ready → find_desktop_element 暴露；Web / 桌面关闭 → 隐藏", () => {
    const ready = getKiroToolsForRequest({
      computerSnapshot: {
        enabled: true,
        agentMode: "workspace-auto",
        desktopControlEnabled: true,
        desktopControlAvailable: true,
        desktopActionEnabled: true,
        desktopActionAvailable: true,
      },
    });
    expect(ready).toHaveProperty("find_desktop_element");

    const web = getKiroToolsForRequest({
      computerSnapshot: {
        enabled: true,
        agentMode: "workspace-auto",
        desktopControlEnabled: true,
        desktopControlAvailable: false,
        desktopActionEnabled: true,
        desktopActionAvailable: false,
      },
    });
    expect(web).not.toHaveProperty("find_desktop_element");

    const observeOff = getKiroToolsForRequest({
      computerSnapshot: {
        enabled: true,
        agentMode: "workspace-auto",
        desktopControlEnabled: false,
        desktopControlAvailable: true,
        desktopActionEnabled: false,
        desktopActionAvailable: true,
      },
    });
    expect(observeOff).not.toHaveProperty("find_desktop_element");
  });
});
