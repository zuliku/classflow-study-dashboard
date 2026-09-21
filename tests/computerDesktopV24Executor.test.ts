// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { executeKiroComputerTool } from "@/lib/ai/computer/executor";
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

function runTool(toolName: string, toolInput: unknown, snapshotOverride?: KiroComputerTurnSnapshot) {
  return executeKiroComputerTool({
    toolName,
    toolCallId: `call-${Math.random().toString(36).slice(2, 8)}`,
    toolInput,
    context: {
      turnSnapshot: snapshotOverride ?? snapshot(),
      liveWorkspaces: [WORKSPACE],
      livePermissionRules: [],
      taskId: "task-1",
    },
    counters: { readCount: 0, mutationCount: 0, terminalCount: 0 },
    oneShotApprovals: [],
  });
}

const CONFIRM: FakeElement = {
  elementId: "el-1",
  role: "Button",
  name: "确定",
  bounds: { x: 100, y: 100, width: 120, height: 40 },
};

afterEach(() => {
  delete (window as unknown as { classflowDesktop?: unknown }).classflowDesktop;
  useDesktopSessionStore.getState().clear();
});

describe("V2.4 执行器 — 受保护应用（blocked 画像）", () => {
  it("observe_desktop 透出 blocked 画像；desktop_action → ACTION_BLOCKED", async () => {
    const world = new FakeDesktopWorld([
      { windowId: "win-1password", title: "1Password", appName: "1password", elements: [CONFIRM] },
    ]);
    installFakeDesktopBridge(world);

    const observe = await runTool("observe_desktop", {});
    expect(observe.kind).toBe("completed");
    if (observe.kind !== "completed" || !observe.output.ok) throw new Error("observe failed");
    const observation = observe.output.data as { observationId: string; appProfile?: { blocked?: boolean } };
    expect(observation.appProfile?.blocked).toBe(true);

    const attempt = await runTool("desktop_action", {
      action: "click",
      observationId: observation.observationId,
      target: { elementId: "el-1" },
    });
    expect(attempt).toMatchObject({ kind: "completed", output: { ok: false, code: "ACTION_BLOCKED" } });
    expect(world.log.filter((entry) => entry.tool === "action")).toHaveLength(0);
  });
});

describe("V2.4 执行器 — 应用画像高风险控件", () => {
  it("微信「转账」→ 高风险审批（仅 deny / allow-once）", async () => {
    const world = new FakeDesktopWorld([
      {
        windowId: "win-wechat",
        title: "微信",
        appName: "wechat",
        elements: [{ ...CONFIRM, elementId: "el-1", name: "转账" }],
      },
    ]);
    installFakeDesktopBridge(world);

    const observe = await runTool("observe_desktop", {});
    if (observe.kind !== "completed" || !observe.output.ok) throw new Error("observe failed");
    const { observationId } = observe.output.data as { observationId: string };

    const attempt = await runTool("desktop_action", {
      action: "click",
      observationId,
      target: { elementId: "el-1" },
    });
    expect(attempt.kind).toBe("approval-required");
    if (attempt.kind !== "approval-required") return;
    expect(attempt.request.gui?.riskLevel).toBe("external");
    expect(attempt.request.allowedDecisions).toEqual(["deny", "allow-once"]);
  });
});

describe("V2.4 执行器 — Sidecar 画像透传", () => {
  it("session 事件携带 appProfile（Sidecar 显示应用 label）", () => {
    useDesktopSessionStore.getState().applyEvent({
      type: "session",
      sessionId: "cs-1",
      state: "observing",
      appName: "wechat",
      windowTitle: "微信",
      actionLabel: null,
      actions: 1,
      observations: 1,
      updatedAt: 1,
      goal: null,
      plan: [],
      stepIndex: 0,
      reflectionRequired: false,
      appProfile: { id: "im", label: "即时通讯", blocked: false },
    });
    expect(useDesktopSessionStore.getState().appProfile).toEqual({
      id: "im",
      label: "即时通讯",
      blocked: false,
    });
    useDesktopSessionStore.getState().clear();
    expect(useDesktopSessionStore.getState().appProfile).toBeNull();
  });
});
