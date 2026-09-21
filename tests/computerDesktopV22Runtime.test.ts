// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { DesktopObservationRuntime, type DesktopObservationDeps } from "@/src/main/computer/runtime";
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
  const state = { now: 1_000_000, uiElements: [WINDOW_ELEMENT, SEARCH_ELEMENT] as NativeUiElement[] };
  const deps: DesktopObservationDeps = {
    platform: "win32",
    listWindows: async () => [windowRecord()],
    captureScreenshot: async () => null,
    inspectUiTree: async () => ({ elements: state.uiElements, truncated: false }),
    probeUiAutomation: async () => true,
    getPrimaryScreenSize: () => ({ width: 1920, height: 1080 }),
    runGuiAction: vi.fn(async () => ({ ok: true, method: "uia-invoke" })),
    activateWindow: async () => true,
    resolveApp: async (appId) => ({ kind: "appsFolder", appId: `Fake.${appId}`, label: appId }),
    launchApp: () => true,
    sleep: async (ms: number) => {
      state.now += ms;
    },
    now: () => state.now,
    ...overrides,
  };
  return { deps, state };
}

describe("V2.2 — resolveUiElement 依赖（单元素解析，避免全树扫描）", () => {
  it("提供 resolveUiElement 时优先使用（不调用 inspectUiTree 做目标解析）", async () => {
    const resolveUiElement = vi.fn(async () => ({ ...SEARCH_ELEMENT }));
    const inspectUiTree = vi.fn(async () => ({ elements: [WINDOW_ELEMENT, SEARCH_ELEMENT], truncated: false }));
    const { deps } = makeDeps({ resolveUiElement, inspectUiTree });
    const runtime = new DesktopObservationRuntime(deps);
    const observation = await runtime.observe({ includeScreenshot: false });
    const inspectCallsAfterObserve = inspectUiTree.mock.calls.length;

    const result = await runtime.action({
      action: "click",
      observationId: observation.observationId,
      target: { elementId: "el-2" },
      sessionId: SESSION,
    });
    expect(result.actionResult.method).toBe("uia-invoke");
    expect(resolveUiElement).toHaveBeenCalledWith(101, "42.2");
    // 观察内部会扫树；目标解析（prepare + action）不再扫树 —— 只多了 action 后的自动重新观察 1 次
    expect(inspectUiTree.mock.calls.length).toBe(inspectCallsAfterObserve + 1);
  });

  it("resolveUiElement 返回 null → STALE_OBSERVATION（元素消失）", async () => {
    const { deps } = makeDeps({ resolveUiElement: async () => null });
    const runtime = new DesktopObservationRuntime(deps);
    const observation = await runtime.observe({ includeScreenshot: false });
    await expect(
      runtime.action({
        action: "click",
        observationId: observation.observationId,
        target: { elementId: "el-2" },
        sessionId: SESSION,
      })
    ).rejects.toMatchObject({ code: "STALE_OBSERVATION" });
  });

  it("resolveUiElement 抛错（UIA 读取失败）→ OBSERVATION_FAILED", async () => {
    const { deps } = makeDeps({
      resolveUiElement: async () => {
        throw new Error("uia boom");
      },
    });
    const runtime = new DesktopObservationRuntime(deps);
    const observation = await runtime.observe({ includeScreenshot: false });
    await expect(
      runtime.action({
        action: "click",
        observationId: observation.observationId,
        target: { elementId: "el-2" },
        sessionId: SESSION,
      })
    ).rejects.toMatchObject({ code: "OBSERVATION_FAILED" });
  });

  it("未提供 resolveUiElement → 回退全树扫描（向后兼容）", async () => {
    const { deps } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    const observation = await runtime.observe({ includeScreenshot: false });
    const result = await runtime.action({
      action: "click",
      observationId: observation.observationId,
      target: { elementId: "el-2" },
      sessionId: SESSION,
    });
    expect(result.actionResult.method).toBe("uia-invoke");
  });

  it("bounds 变化 → STALE_OBSERVATION（resolve 返回移动后的元素）", async () => {
    const { deps } = makeDeps({
      resolveUiElement: async () => ({ ...SEARCH_ELEMENT, bounds: { x: 900, y: 900, width: 400, height: 40 } }),
    });
    const runtime = new DesktopObservationRuntime(deps);
    const observation = await runtime.observe({ includeScreenshot: false });
    await expect(
      runtime.action({
        action: "click",
        observationId: observation.observationId,
        target: { elementId: "el-2" },
        sessionId: SESSION,
      })
    ).rejects.toMatchObject({ code: "STALE_OBSERVATION" });
  });
});
