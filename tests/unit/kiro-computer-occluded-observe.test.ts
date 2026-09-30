// @vitest-environment node
/**
 * 后台静默操作 Phase 2 — observe 遮挡截图闭环。
 *
 * desktopCapturer 按标题匹配 source，遮挡窗口匹配失败会降级拍主屏（错误像素
 * 比没截图更有害）。非前台窗口的 observe(includeScreenshot:true) 必须走
 * hwnd 精确 PrintWindow（captureOccludedWindow），失败仅记 warning，绝不
 * 回退到主屏截图；前台窗口与 screen 目标保持既有 desktopCapturer 路径。
 */
import { describe, it, expect, vi } from "vitest";
import {
  DesktopObservationRuntime,
  type DesktopObservationDeps,
} from "@/src/main/computer/runtime";
import type { NativeWindowRecord } from "@/src/main/computer/windows";

function windowRecord(overrides: Partial<NativeWindowRecord> = {}): NativeWindowRecord {
  return {
    hwnd: 101,
    pid: 4242,
    title: "前台 - 记事本",
    appName: "notepad",
    bounds: { x: 0, y: 0, width: 1280, height: 720 },
    isActive: true,
    isOffscreen: false,
    zIndex: 0,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<DesktopObservationDeps> = {}) {
  const active = windowRecord();
  const occluded = windowRecord({
    hwnd: 202,
    pid: 7777,
    title: "被挡 - 浏览器",
    appName: "chrome",
    isActive: false,
    zIndex: 1,
  });
  const captureScreenshot = vi.fn(async () => ({
    mimeType: "image/jpeg" as const,
    dataUrl: "data:image/jpeg;base64,AAAA",
    width: 960,
    height: 540,
    bytes: 1024,
    capturedAt: "2026-09-21T00:00:01.000Z",
  }));
  const captureOccludedWindow = vi.fn(async (_hwnd: number) => ({
    mimeType: "image/jpeg" as const,
    dataUrl: "data:image/jpeg;base64,BBBB",
    width: 800,
    height: 600,
    bytes: 2048,
    capturedAt: "2026-09-21T00:00:02.000Z",
  }));
  const deps = {
    platform: "win32" as const,
    listWindows: async () => [active, occluded],
    captureScreenshot,
    captureOccludedWindow,
    inspectUiTree: async () => ({ elements: [], truncated: false }),
    probeUiAutomation: async () => true,
    getPrimaryScreenSize: () => ({ width: 1920, height: 1080 }),
    runGuiAction: async () => ({ ok: true, method: "uia-invoke" }),
    activateWindow: async () => true,
    resolveApp: async () => ({ kind: "none" as const }),
    launchApp: () => false,
    sleep: async () => {},
    now: () => 1_000_000,
    ...overrides,
  } as unknown as DesktopObservationDeps;
  return { deps, active, occluded, captureScreenshot, captureOccludedWindow };
}

describe("observe 遮挡截图：非前台窗口优先 PrintWindow", () => {
  it("被挡窗口 windowId 观察 → PrintWindow，不调 desktopCapturer", async () => {
    const { deps, captureScreenshot, captureOccludedWindow } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    const first = await runtime.observe({ includeScreenshot: false });
    const occludedId = first.windows.find((w) => !w.active)?.windowId;
    expect(occludedId).toBeTruthy();
    captureScreenshot.mockClear();
    captureOccludedWindow.mockClear();

    const second = await runtime.observe({ windowId: occludedId! });
    expect(captureOccludedWindow).toHaveBeenCalledTimes(1);
    expect(captureOccludedWindow.mock.calls[0][0]).toBe(202);
    expect(captureScreenshot).not.toHaveBeenCalled();
    expect(second.screenshot?.dataUrl).toContain("BBBB");
    expect(second.warnings).not.toContain("screenshot-unavailable");
  });

  it("PrintWindow 失败 → 无截图 + warning，不回退主屏（无错误像素）", async () => {
    const { deps, captureScreenshot, captureOccludedWindow } = makeDeps({
      captureOccludedWindow: async () => null,
    });
    const runtime = new DesktopObservationRuntime(deps);
    const first = await runtime.observe({ includeScreenshot: false });
    const occludedId = first.windows.find((w) => !w.active)?.windowId!;
    (captureScreenshot as ReturnType<typeof vi.fn>).mockClear();
    (captureOccludedWindow as ReturnType<typeof vi.fn>).mockClear();

    const second = await runtime.observe({ windowId: occludedId });
    expect(second.screenshot).toBeNull();
    expect(second.warnings).toContain("screenshot-unavailable");
    expect(captureScreenshot).not.toHaveBeenCalled();
  });

  it("前台窗口与 screen 目标仍走 desktopCapturer（既有行为不变）", async () => {
    const { deps, captureScreenshot, captureOccludedWindow } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);

    // 默认观察落在前台窗口
    const activeObs = await runtime.observe({});
    expect(captureScreenshot).toHaveBeenCalled();
    expect(activeObs.screenshot?.dataUrl).toContain("AAAA");

    (captureScreenshot as ReturnType<typeof vi.fn>).mockClear();
    (captureOccludedWindow as ReturnType<typeof vi.fn>).mockClear();
    const screenObs = await runtime.observe({ target: "screen" });
    expect(captureScreenshot).toHaveBeenCalled();
    expect(captureOccludedWindow).not.toHaveBeenCalled();
    expect(screenObs.screenshot?.dataUrl).toContain("AAAA");
  });
});
