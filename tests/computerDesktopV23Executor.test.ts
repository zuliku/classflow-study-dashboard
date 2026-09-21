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

function runTool(
  toolName: string,
  toolInput: unknown,
  options: {
    snapshot?: KiroComputerTurnSnapshot;
    counters?: { readCount: number; mutationCount: number; terminalCount: number };
    toolCallId?: string;
  } = {}
) {
  return executeKiroComputerTool({
    toolName,
    toolCallId: options.toolCallId ?? `call-${Math.random().toString(36).slice(2, 8)}`,
    toolInput,
    context: {
      turnSnapshot: options.snapshot ?? snapshot(),
      liveWorkspaces: [WORKSPACE],
      livePermissionRules: [],
      taskId: "task-1",
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

afterEach(() => {
  delete (window as unknown as { classflowDesktop?: unknown }).classflowDesktop;
  useDesktopSessionStore.getState().clear();
});

describe("V2.3 desktop_session（执行器）", () => {
  it("set_goal → update_plan → complete_step 全链路（不消耗 read/mutation 预算）", async () => {
    const world = new FakeDesktopWorld([
      { windowId: "win-chrome", title: "Google", appName: "chrome", elements: [SEARCH] },
    ]);
    installFakeDesktopBridge(world);
    const counters = { readCount: 0, mutationCount: 0, terminalCount: 0 };

    const goalResult = dataOf(
      await runTool("desktop_session", { action: "set_goal", goal: "在浏览器搜索 ClassFlow" }, { counters })
    );
    expect(goalResult.goal).toBe("在浏览器搜索 ClassFlow");

    const planResult = dataOf(
      await runTool(
        "desktop_session",
        { action: "update_plan", plan: ["打开浏览器", "搜索 ClassFlow", "读取结果"] },
        { counters }
      )
    );
    expect(planResult.plan).toEqual(["打开浏览器", "搜索 ClassFlow", "读取结果"]);
    expect(planResult.stepIndex).toBe(0);
    expect(planResult.currentStep).toBe("打开浏览器");

    const stepResult = dataOf(await runTool("desktop_session", { action: "complete_step" }, { counters }));
    expect(stepResult.stepIndex).toBe(1);
    expect(stepResult.currentStep).toBe("搜索 ClassFlow");

    expect(counters.readCount).toBe(0);
    expect(counters.mutationCount).toBe(0);
  });

  it("malformed 输入 → INVALID_INPUT；无 session → PERMISSION_DENIED", async () => {
    const world = new FakeDesktopWorld([
      { windowId: "win-chrome", title: "Google", appName: "chrome", elements: [SEARCH] },
    ]);
    installFakeDesktopBridge(world);
    const bad = await runTool("desktop_session", { action: "set_goal" });
    expect(bad).toMatchObject({ kind: "completed", output: { ok: false, code: "INVALID_INPUT" } });

    const noSession = await runTool(
      "desktop_session",
      { action: "set_goal", goal: "x" },
      { snapshot: snapshot({ desktopSessionId: undefined }) }
    );
    expect(noSession).toMatchObject({ kind: "completed", output: { ok: false, code: "PERMISSION_DENIED" } });
  });

  it("暴露：ready → 可用（Plan 模式也可用，因为它只读）；Web runtime → 隐藏", () => {
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
    expect(ready).toHaveProperty("desktop_session");

    const plan = getKiroToolsForRequest({
      computerSnapshot: {
        enabled: true,
        agentMode: "plan",
        desktopControlEnabled: true,
        desktopControlAvailable: true,
        desktopActionEnabled: false,
        desktopActionAvailable: true,
      },
    });
    expect(plan).toHaveProperty("desktop_session");
    expect(plan).not.toHaveProperty("desktop_action");

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
    expect(web).not.toHaveProperty("desktop_session");
  });
});

describe("V2.3 反思提示（action 输出）", () => {
  it("连续 2 次 expect 未通过 → reflectionRequired + hint；更新计划后消费", async () => {
    const world = new FakeDesktopWorld([
      { windowId: "win-chrome", title: "Google", appName: "chrome", elements: [SEARCH] },
    ]);
    installFakeDesktopBridge(world);
    const counters = { readCount: 0, mutationCount: 0, terminalCount: 0 };
    const observation = dataOf(await runTool("observe_desktop", {}, { counters }));

    const failingInput = {
      action: "click",
      observationId: observation.observationId,
      target: { elementId: "el-1" },
      expect: { textAppears: "永远不会出现" },
    };
    const first = dataOf(await runTool("desktop_action", failingInput, { counters }));
    expect(first.expectationPassed).toBe(false);
    expect(first.reflectionRequired).toBeUndefined();

    const second = dataOf(await runTool("desktop_action", failingInput, { counters }));
    expect(second.reflectionRequired).toBe(true);
    expect(String(second.reflectionHint)).toContain("重新 observe_desktop");

    // 模型更新计划 → 反思被消费
    await runTool("desktop_session", { action: "update_plan", plan: ["换一种定位方式"] }, { counters });
    const third = dataOf(
      await runTool(
        "desktop_action",
        { ...failingInput, observationId: second.observationId },
        { counters }
      )
    );
    expect(third.reflectionRequired).toBeUndefined();
  });
});

describe("V2.3 Sidecar Session Store — 计划字段透传", () => {
  it("session 事件携带 plan/stepIndex/reflectionRequired", () => {
    useDesktopSessionStore.getState().applyEvent({
      type: "session",
      sessionId: "cs-1",
      state: "acting",
      appName: "chrome",
      windowTitle: "Google",
      actionLabel: "click el-1",
      actions: 2,
      observations: 3,
      updatedAt: 1,
      goal: "搜索 ClassFlow",
      plan: ["打开浏览器", "搜索"],
      stepIndex: 1,
      reflectionRequired: true,
    });
    const state = useDesktopSessionStore.getState();
    expect(state.goal).toBe("搜索 ClassFlow");
    expect(state.plan).toEqual(["打开浏览器", "搜索"]);
    expect(state.stepIndex).toBe(1);
    expect(state.reflectionRequired).toBe(true);
    useDesktopSessionStore.getState().clear();
    expect(useDesktopSessionStore.getState().plan).toEqual([]);
    expect(useDesktopSessionStore.getState().reflectionRequired).toBe(false);
  });
});
