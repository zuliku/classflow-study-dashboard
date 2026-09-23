// @vitest-environment jsdom
/**
 * P5 — Preview evidence 产生链（§24/§26/§57）。
 *
 * 覆盖：observe_desktop 成功后发布 UI evidence；desktop_action 的自动 re-observe 同样发布；
 * Tool Output 仍不包含 dataUrl（模型看不到像素）；blocked / 无 session / 无截图 → 不发布；
 * evidence 只含安全字段（无 elements / elementId / observationId / windowId / HWND / PID）。
 */
import { describe, it, expect, afterEach } from "vitest";
import { executeKiroComputerTool } from "@/lib/ai/computer/executor";
import { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import { KiroWorkspaceMeta } from "@/lib/ai/computer/types";
import type { DesktopObservationUiEvidence } from "@/lib/ai/computer/gui/uiEvidence";
import { useDesktopSessionStore } from "@/store/useDesktopSessionStore";
import {
  FakeDesktopWorld,
  installFakeDesktopBridge,
  type FakeElement,
} from "@/tests/helpers/fakeDesktopRuntime";

const SESSION = "cs-11111111-2222-3333-4444-555555555555";

const NATIVE_WORKSPACE: KiroWorkspaceMeta = {
  id: "ws-1",
  name: "课程资料",
  roots: [{ id: "root-1", label: "资料", access: "read-write", adapterRef: "native:grant_test123" }],
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
    desktopSessionId: SESSION,
    ...overrides,
  };
}

const BUTTON: FakeElement = {
  elementId: "el-1",
  role: "Button",
  name: "确定",
  bounds: { x: 100, y: 100, width: 120, height: 40 },
};

const evidence: DesktopObservationUiEvidence[] = [];

function runTool(
  toolName: string,
  toolInput: unknown,
  options: { snapshot?: KiroComputerTurnSnapshot; workspaces?: KiroWorkspaceMeta[] } = {}
) {
  return executeKiroComputerTool({
    toolName,
    toolCallId: "call-1",
    toolInput,
    context: {
      turnSnapshot: options.snapshot ?? snapshot(),
      liveWorkspaces: options.workspaces ?? [NATIVE_WORKSPACE],
      livePermissionRules: [],
      taskId: "task-1",
      onDesktopObservationEvidence: (value) => evidence.push(value),
    },
    counters: { readCount: 0, mutationCount: 0, terminalCount: 0 },
    oneShotApprovals: [],
  });
}

afterEach(() => {
  delete (window as unknown as { classflowDesktop?: unknown }).classflowDesktop;
  useDesktopSessionStore.getState().clear();
  evidence.length = 0;
});

describe("P5 Preview evidence — observe_desktop", () => {
  it("真实观察成功 → 发布 evidence（sessionId / 截图 / 应用）；Tool Output 不含 dataUrl", async () => {
    const world = new FakeDesktopWorld([
      { windowId: "win-wechat", title: "文件传输助手", appName: "wechat", elements: [BUTTON] },
    ]);
    installFakeDesktopBridge(world);

    const attempt = await runTool("observe_desktop", {});
    expect(attempt.kind).toBe("completed");
    expect(evidence).toHaveLength(1);
    expect(evidence[0].sessionId).toBe(SESSION);
    expect(evidence[0].dataUrl.startsWith("data:image/jpeg")).toBe(true);
    expect(evidence[0].appName).toBe("wechat");
    expect(evidence[0].windowTitle).toBe("文件传输助手");
    expect(evidence[0].appProfileBlocked).toBe(false);

    // Tool Output 只含 summarizeObservation（dataUrl 绝不进入模型）
    const output = attempt.kind === "completed" ? attempt.output : null;
    const serialized = JSON.stringify(output);
    expect(serialized).not.toContain("dataUrl");
    expect(serialized).not.toContain("base64");
    // evidence 最小化数据面（不含 elements / elementId / observationId / windowId）
    expect(Object.keys(evidence[0]).sort()).toEqual(
      [
        "appName",
        "appProfileBlocked",
        "capturedAt",
        "dataUrl",
        "height",
        "mimeType",
        "sessionId",
        "width",
        "windowTitle",
      ].sort()
    );
  });

  it("无 session（desktopSessionId 缺失）→ 不发布 evidence", async () => {
    const world = new FakeDesktopWorld([
      { windowId: "win-wechat", title: "文件传输助手", appName: "wechat", elements: [BUTTON] },
    ]);
    installFakeDesktopBridge(world);

    await runTool("observe_desktop", {}, { snapshot: snapshot({ desktopSessionId: undefined }) });
    expect(evidence).toHaveLength(0);
  });

  it("受保护应用（blocked：网上银行）→ 不发布 evidence", async () => {
    const world = new FakeDesktopWorld([
      { windowId: "win-bank", title: "网上银行", appName: "bankapp", elements: [BUTTON] },
    ]);
    installFakeDesktopBridge(world);

    await runTool("observe_desktop", {});
    expect(evidence).toHaveLength(0);
  });
});

describe("P5 Preview evidence — desktop_action 自动 re-observe", () => {
  it("动作成功后的新 observation 有截图 → 更新 evidence（只保留最新一张）", async () => {
    const world = new FakeDesktopWorld([
      { windowId: "win-wechat", title: "文件传输助手", appName: "wechat", elements: [BUTTON] },
    ]);
    installFakeDesktopBridge(world);

    // 先 observe（产生 observation 绑定 + evidence #1）
    const observeAttempt = await runTool("observe_desktop", {});
    expect(evidence).toHaveLength(1);
    const observationId =
      observeAttempt.kind === "completed"
        ? ((observeAttempt.output as { data?: { observationId?: string } }).data?.observationId ?? "")
        : "";

    // desktop_action：Main 侧自动 re-observe → 新截图
    const attempt = await runTool("desktop_action", {
      action: "click",
      observationId,
      target: { elementId: "el-1" },
    });
    expect(attempt.kind).toBe("completed");
    expect(evidence.length).toBeGreaterThanOrEqual(2);
    const latest = evidence[evidence.length - 1];
    expect(latest.sessionId).toBe(SESSION);
    expect(latest.dataUrl.startsWith("data:image/jpeg")).toBe(true);

    // action Tool Output 同样不含像素
    const output = attempt.kind === "completed" ? attempt.output : null;
    expect(JSON.stringify(output)).not.toContain("dataUrl");
  });
});
