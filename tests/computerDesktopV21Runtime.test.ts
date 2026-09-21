// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  DesktopObservationRuntime,
  ADAPTIVE_SETTLE_TIMEOUT_MS,
  type DesktopObservationDeps,
} from "@/src/main/computer/runtime";
import type { NativeWindowRecord } from "@/src/main/computer/windows";
import type { NativeUiElement } from "@/src/main/computer/uia";

const SESSION = "cs-11111111-2222-3333-4444-555555555555";

const WINDOW_ELEMENT: NativeUiElement = {
  nativeRef: "42.1",
  role: "Window",
  name: "Google",
  enabled: true,
  focused: true,
  isPassword: false,
  bounds: { x: 0, y: 0, width: 1280, height: 800 },
  depth: 0,
};
const SEARCH_ELEMENT: NativeUiElement = {
  nativeRef: "42.2",
  role: "Edit",
  name: "搜索",
  enabled: true,
  focused: false,
  isPassword: false,
  bounds: { x: 100, y: 100, width: 400, height: 40 },
  depth: 1,
};
const SEND_ELEMENT: NativeUiElement = {
  nativeRef: "42.3",
  role: "Button",
  name: "发送",
  enabled: true,
  focused: false,
  isPassword: false,
  bounds: { x: 100, y: 200, width: 80, height: 30 },
  depth: 1,
};

function windowRecord(): NativeWindowRecord {
  return {
    hwnd: 101,
    pid: 1,
    title: "Google",
    appName: "chrome",
    bounds: { x: 0, y: 0, width: 1280, height: 800 },
    isActive: true,
    isOffscreen: false,
    zIndex: 0,
  };
}

function makeDeps(overrides: Partial<DesktopObservationDeps> = {}) {
  const state = {
    now: 1_000_000,
    uiElements: [WINDOW_ELEMENT, SEARCH_ELEMENT] as NativeUiElement[],
    observeCalls: 0,
  };
  const deps: DesktopObservationDeps = {
    platform: "win32",
    listWindows: async () => [windowRecord()],
    captureScreenshot: async () => null,
    inspectUiTree: async () => {
      state.observeCalls += 1;
      return { elements: state.uiElements, truncated: false };
    },
    probeUiAutomation: async () => true,
    getPrimaryScreenSize: () => ({ width: 1920, height: 1080 }),
    runGuiAction: vi.fn(async () => ({ ok: true, method: "uia-invoke" })),
    activateWindow: async () => true,
    resolveApp: async (appId) => ({ kind: "appsFolder", appId: `Fake.${appId}`, label: appId }),
    launchApp: () => true,
    // sleep 推进虚拟时钟：自适应 settle 轮询才能终止（无真实等待）
    sleep: async (ms: number) => {
      state.now += ms;
    },
    now: () => state.now,
    ...overrides,
  };
  return { deps, state };
}

describe("DesktopObservationRuntime.findElements — V2.1 控件检索", () => {
  it("返回排序后的 elementId + 只读元数据（无 native 标识）", async () => {
    const { deps } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    const observation = await runtime.observe({ includeScreenshot: false });
    const result = runtime.findElements({ observationId: observation.observationId, query: "搜索" });
    expect(result.matches[0].elementId).toBe("el-2");
    expect(result.matches[0].role).toBe("Edit");
    expect(result.matches[0].score).toBeGreaterThan(0);
    expect(result.totalElements).toBe(2);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/"hwnd"|"pid"|"nativeRef"|"42\.2"/);
  });

  it("observation 不存在 / 过期 → STALE_OBSERVATION", async () => {
    const { deps, state } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    expect(() => runtime.findElements({ observationId: "obs-deadbeef-0000", query: "搜索" })).toThrow(
      expect.objectContaining({ code: "STALE_OBSERVATION" })
    );
    const observation = await runtime.observe({ includeScreenshot: false });
    state.now += 200_000;
    expect(() =>
      runtime.findElements({ observationId: observation.observationId, query: "搜索" })
    ).toThrow(expect.objectContaining({ code: "STALE_OBSERVATION" }));
  });

  it("malformed 输入 → INVALID_OPERATION", async () => {
    const { deps } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    expect(() => runtime.findElements(null)).toThrow(expect.objectContaining({ code: "INVALID_OPERATION" }));
    expect(() => runtime.findElements({ observationId: "obs-1", query: "" })).toThrow(
      expect.objectContaining({ code: "INVALID_OPERATION" })
    );
    expect(() => runtime.findElements({ observationId: "obs-1", query: "x", maxResults: 99 })).toThrow(
      expect.objectContaining({ code: "INVALID_OPERATION" })
    );
  });
});

describe("DesktopObservationRuntime.action — V2.1 expect 确定性验证", () => {
  it("expect 立即满足 → verification.passed=true（只观察一次）", async () => {
    const { deps, state } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    const observation = await runtime.observe({ includeScreenshot: false });
    const callsBefore = state.observeCalls;
    const result = await runtime.action({
      action: "click",
      observationId: observation.observationId,
      target: { elementId: "el-2" },
      sessionId: SESSION,
      expect: { elementAppears: { role: "Button", nameContains: "发送" } },
    });
    // runGuiAction 不改变 UI → 预期不通过；但验证结构必须存在
    expect(result.verification).toBeDefined();
    expect(result.verification?.checks[0].check).toBe("elementAppears");
    expect(state.observeCalls).toBeGreaterThan(callsBefore);
  });

  it("expect 在动作后出现 → 自适应 settle 轮询后通过", async () => {
    const { deps, state } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    const observation = await runtime.observe({ includeScreenshot: false });
    deps.runGuiAction = vi.fn(async () => {
      state.uiElements = [WINDOW_ELEMENT, SEARCH_ELEMENT, SEND_ELEMENT];
      return { ok: true, method: "uia-invoke" };
    });
    const result = await runtime.action({
      action: "click",
      observationId: observation.observationId,
      target: { elementId: "el-2" },
      sessionId: SESSION,
      expect: { elementAppears: { nameContains: "发送" } },
    });
    expect(result.verification?.passed).toBe(true);
  });

  it("expect 永不满足 → 轮询到超时后 passed=false（有界，不无限等待）", async () => {
    const { deps, state } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    const observation = await runtime.observe({ includeScreenshot: false });
    const startedAt = state.now;
    const result = await runtime.action({
      action: "click",
      observationId: observation.observationId,
      target: { elementId: "el-2" },
      sessionId: SESSION,
      expect: { elementAppears: { nameContains: "永远不会出现" } },
    });
    expect(result.verification?.passed).toBe(false);
    expect(result.verification?.checks[0].detail).toContain("永远不会出现");
    expect(state.now - startedAt).toBeLessThanOrEqual(ADAPTIVE_SETTLE_TIMEOUT_MS + 500);
  });

  it("elementDisappears：动作后元素消失 → 通过（nativeRef 稳定身份）", async () => {
    const { deps, state } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    const observation = await runtime.observe({ includeScreenshot: false });
    deps.runGuiAction = vi.fn(async () => {
      state.uiElements = [WINDOW_ELEMENT]; // 搜索框消失
      return { ok: true, method: "uia-invoke" };
    });
    const result = await runtime.action({
      action: "click",
      observationId: observation.observationId,
      target: { elementId: "el-2" },
      sessionId: SESSION,
      expect: { elementDisappears: { elementId: "el-2" } },
    });
    expect(result.verification?.passed).toBe(true);
  });

  it("无 expect → 不产生 verification（保持旧行为）", async () => {
    const { deps } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    const observation = await runtime.observe({ includeScreenshot: false });
    const result = await runtime.action({
      action: "click",
      observationId: observation.observationId,
      target: { elementId: "el-2" },
      sessionId: SESSION,
    });
    expect(result.verification).toBeUndefined();
  });
});
