// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { DesktopObservationRuntime, type DesktopObservationDeps } from "@/src/main/computer/runtime";
import type { NativeWindowRecord } from "@/src/main/computer/windows";
import type { NativeUiElement } from "@/src/main/computer/uia";
import { buildGuiActionScript } from "@/src/main/computer/guiAction";

const SESSION = "cs-11111111-2222-3333-4444-555555555555";

const WINDOW_ELEMENT: NativeUiElement = {
  nativeRef: "42.1",
  role: "Window",
  name: "窗口",
  enabled: true,
  focused: true,
  isPassword: false,
  bounds: { x: 0, y: 0, width: 1000, height: 800 },
  depth: 0,
};
const SOURCE_ELEMENT: NativeUiElement = {
  nativeRef: "42.2",
  role: "ListItem",
  name: "文件 A",
  enabled: true,
  focused: false,
  isPassword: false,
  bounds: { x: 100, y: 100, width: 200, height: 40 },
  depth: 1,
};
const TARGET_ELEMENT: NativeUiElement = {
  nativeRef: "42.3",
  role: "ListItem",
  name: "文件夹 B",
  enabled: true,
  focused: false,
  isPassword: false,
  bounds: { x: 600, y: 600, width: 200, height: 40 },
  depth: 1,
};
const FILE_DIALOG_ELEMENTS: NativeUiElement[] = [
  WINDOW_ELEMENT,
  {
    nativeRef: "42.10",
    role: "Edit",
    name: "文件名(N):",
    enabled: true,
    focused: true,
    isPassword: false,
    bounds: { x: 100, y: 700, width: 400, height: 30 },
    depth: 1,
  },
  {
    nativeRef: "42.11",
    role: "Button",
    name: "打开(O)",
    enabled: true,
    focused: false,
    isPassword: false,
    bounds: { x: 520, y: 700, width: 80, height: 30 },
    depth: 1,
  },
];

function windowRecord(overrides: Partial<NativeWindowRecord> = {}): NativeWindowRecord {
  return {
    hwnd: 101,
    pid: 1,
    title: "文件资源管理器",
    appName: "explorer",
    bounds: { x: 0, y: 0, width: 1000, height: 800 },
    isActive: true,
    isOffscreen: false,
    zIndex: 0,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<DesktopObservationDeps> = {}) {
  const state = {
    now: 1_000_000,
    uiElements: [WINDOW_ELEMENT, SOURCE_ELEMENT, TARGET_ELEMENT] as NativeUiElement[],
    sleeps: [] as number[],
    windows: [windowRecord()] as NativeWindowRecord[],
  };
  const deps: DesktopObservationDeps = {
    platform: "win32",
    listWindows: async () => state.windows,
    captureScreenshot: async () => null,
    inspectUiTree: async () => ({ elements: state.uiElements, truncated: false }),
    probeUiAutomation: async () => true,
    getPrimaryScreenSize: () => ({ width: 1920, height: 1080 }),
    runGuiAction: vi.fn(async () => ({ ok: true, method: "drag" })),
    activateWindow: async () => true,
    resolveApp: async (appId) => ({ kind: "appsFolder", appId: `Fake.${appId}`, label: appId }),
    launchApp: () => true,
    sleep: async (ms: number) => {
      state.sleeps.push(ms);
      state.now += ms;
    },
    now: () => state.now,
    ...overrides,
  };
  return { deps, state };
}

describe("V2.5 运行时 — 拖拽", () => {
  it("target + to 均在窗口内 → native 收到 point/toPoint", async () => {
    const { deps, state } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    const observation = await runtime.observe({ includeScreenshot: false });
    await runtime.action({
      action: "drag",
      observationId: observation.observationId,
      target: { elementId: "el-2" },
      to: { elementId: "el-3" },
      sessionId: SESSION,
    });
    const config = (deps.runGuiAction as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      action: string;
      expectedBounds?: { x: number; y: number; width: number; height: number };
      toPoint?: { x: number; y: number };
    };
    expect(config.action).toBe("drag");
    // 起点用元素 bounds（native 脚本取中心），落点显式传 toPoint
    expect(config.expectedBounds).toEqual({ x: 100, y: 100, width: 200, height: 40 });
    expect(config.toPoint).toEqual({ x: 700, y: 620 });
    expect(state.sleeps.length).toBeGreaterThan(0);
  });

  it("落点在窗口外 → INVALID_OPERATION（不执行 native）", async () => {
    const { deps } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    const observation = await runtime.observe({ includeScreenshot: false });
    await expect(
      runtime.action({
        action: "drag",
        observationId: observation.observationId,
        target: { elementId: "el-2" },
        to: { normalized: { x: 1, y: 1 } },
        sessionId: SESSION,
      })
    ).rejects.toMatchObject({ code: "INVALID_OPERATION" });
    expect(deps.runGuiAction).not.toHaveBeenCalled();
  });

  it("to 元素不在当前 observation → STALE_OBSERVATION", async () => {
    const { deps } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    const observation = await runtime.observe({ includeScreenshot: false });
    await expect(
      runtime.action({
        action: "drag",
        observationId: observation.observationId,
        target: { elementId: "el-2" },
        to: { elementId: "el-9" },
        sessionId: SESSION,
      })
    ).rejects.toMatchObject({ code: "STALE_OBSERVATION" });
  });
});

describe("V2.5 运行时 — hover / 横向滚动", () => {
  it("hover 走 native（元素中心），方法 uia-hover", async () => {
    const { deps } = makeDeps({ runGuiAction: vi.fn(async () => ({ ok: true, method: "uia-hover" })) });
    const runtime = new DesktopObservationRuntime(deps);
    const observation = await runtime.observe({ includeScreenshot: false });
    const result = await runtime.action({
      action: "hover",
      observationId: observation.observationId,
      target: { elementId: "el-2" },
      sessionId: SESSION,
    });
    expect(result.actionResult.method).toBe("uia-hover");
  });

  it("scroll + axis=horizontal 透传到 native config", async () => {
    const { deps } = makeDeps({ runGuiAction: vi.fn(async () => ({ ok: true, method: "scroll-horizontal" })) });
    const runtime = new DesktopObservationRuntime(deps);
    const observation = await runtime.observe({ includeScreenshot: false });
    const result = await runtime.action({
      action: "scroll",
      observationId: observation.observationId,
      target: { elementId: "el-2" },
      scroll: 3,
      axis: "horizontal",
      sessionId: SESSION,
    });
    expect(result.actionResult.method).toBe("scroll-horizontal");
    const config = (deps.runGuiAction as ReturnType<typeof vi.fn>).mock.calls[0][0] as { axis?: string };
    expect(config.axis).toBe("horizontal");
  });
});

describe("V2.5 运行时 — 剪贴板", () => {
  it("未开启（clipboardAllowed 缺失）→ ACTION_BLOCKED", async () => {
    const readClipboard = vi.fn(() => "secret");
    const { deps } = makeDeps({ readClipboard });
    const runtime = new DesktopObservationRuntime(deps);
    await expect(runtime.action({ action: "clipboard_read", sessionId: SESSION })).rejects.toMatchObject({
      code: "ACTION_BLOCKED",
    });
    expect(readClipboard).not.toHaveBeenCalled();
  });

  it("开启后读取 → 返回有界文本（无 observation）", async () => {
    const { deps } = makeDeps({ readClipboard: () => "复制的内容" });
    const runtime = new DesktopObservationRuntime(deps);
    const result = await runtime.action({
      action: "clipboard_read",
      clipboardAllowed: true,
      sessionId: SESSION,
    });
    expect(result.actionResult.method).toBe("clipboard-read");
    expect(result.clipboardText).toBe("复制的内容");
    expect(result.observation).toBeNull();
  });

  it("开启后写入 → 调用 writeClipboard（失败 → ACTION_FAILED）", async () => {
    const writeClipboard = vi.fn(() => true);
    const { deps } = makeDeps({ writeClipboard });
    const runtime = new DesktopObservationRuntime(deps);
    const result = await runtime.action({
      action: "clipboard_write",
      clipboardAllowed: true,
      clipboardText: "hello",
      sessionId: SESSION,
    });
    expect(writeClipboard).toHaveBeenCalledWith("hello");
    expect(result.actionResult.method).toBe("clipboard-write");

    const failing = makeDeps({ writeClipboard: () => false });
    const failingRuntime = new DesktopObservationRuntime(failing.deps);
    await expect(
      failingRuntime.action({
        action: "clipboard_write",
        clipboardAllowed: true,
        clipboardText: "hello",
        sessionId: SESSION,
      })
    ).rejects.toMatchObject({ code: "ACTION_FAILED" });
  });
});

describe("V2.5 运行时 — 文件上传", () => {
  it("文件对话框 + 已授权文件 → 填入路径 + Enter（不回传路径）", async () => {
    const runGuiAction = vi.fn(async (config: { action: string; text?: string; vk?: number[] }) => ({
      ok: true,
      method: config.action === "type" ? "uia-setvalue" : "sendinput-key",
    }));
    const resolveUploadPath = vi.fn((grantId: string, path: string) => `C:\\root\\${path}`);
    const { deps, state } = makeDeps({
      runGuiAction: runGuiAction as never,
      resolveUploadPath,
      isFileDialog: () => true,
    });
    state.uiElements = FILE_DIALOG_ELEMENTS;
    state.windows = [windowRecord({ appName: "explorer", title: "打开" })];
    const runtime = new DesktopObservationRuntime(deps);
    const observation = await runtime.observe({ includeScreenshot: false });

    const result = await runtime.action({
      action: "upload_file",
      observationId: observation.observationId,
      fileGrant: { grantId: "grant_abc", path: "docs/报告.pdf" },
      sessionId: SESSION,
    });
    expect(result.actionResult.method).toBe("upload-path");
    expect(resolveUploadPath).toHaveBeenCalledWith("grant_abc", "docs/报告.pdf");
    const calls = runGuiAction.mock.calls.map((call) => call[0]);
    expect(calls[0]).toMatchObject({ action: "type", text: "C:\\root\\docs/报告.pdf" });
    expect(calls[1]).toMatchObject({ action: "key", vk: [0x0d] });
    expect(JSON.stringify(result)).not.toContain("C:\\root");
  });

  it("未授权文件 → ACTION_BLOCKED（不执行 native）", async () => {
    const { deps } = makeDeps({ resolveUploadPath: () => null, isFileDialog: () => true });
    const runtime = new DesktopObservationRuntime(deps);
    const observation = await runtime.observe({ includeScreenshot: false });
    await expect(
      runtime.action({
        action: "upload_file",
        observationId: observation.observationId,
        fileGrant: { grantId: "grant_abc", path: "docs/报告.pdf" },
        sessionId: SESSION,
      })
    ).rejects.toMatchObject({ code: "ACTION_BLOCKED" });
    expect(deps.runGuiAction).not.toHaveBeenCalled();
  });

  it("非文件对话框 → prepareAction 风险 blocked，action 拒绝", async () => {
    const { deps } = makeDeps({ resolveUploadPath: () => "C:\\root\\a.txt" });
    const runtime = new DesktopObservationRuntime(deps);
    const observation = await runtime.observe({ includeScreenshot: false });
    const preparation = await runtime.prepareAction({
      action: "upload_file",
      observationId: observation.observationId,
      fileGrant: { grantId: "grant_abc", path: "a.txt" },
      sessionId: SESSION,
    });
    expect(preparation.risk.level).toBe("blocked");
    await expect(
      runtime.action({
        action: "upload_file",
        observationId: observation.observationId,
        fileGrant: { grantId: "grant_abc", path: "a.txt" },
        sessionId: SESSION,
      })
    ).rejects.toMatchObject({ code: "ACTION_BLOCKED" });
  });
});

describe("V2.5 native 脚本 — 新动作原语", () => {
  it("脚本包含横向滚轮 / 右键 / 拖拽 / 窗口边界校验", () => {
    const script = buildGuiActionScript({ hwnd: 1, nativeRef: null, action: "drag", point: { x: 1, y: 2 }, toPoint: { x: 3, y: 4 } });
    expect(script).toContain("0x1000"); // HWHEEL
    expect(script).toContain("Move-And-RightClick");
    expect(script).toContain("Move-And-Drag");
    expect(script).toContain("GetWindowRect");
    expect(script).toContain("outside-window");
    expect(script).toContain("scroll-horizontal");
  });
});
