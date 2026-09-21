// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { DesktopObservationRuntime, type DesktopObservationDeps } from "@/src/main/computer/runtime";
import type { NativeWindowRecord } from "@/src/main/computer/windows";
import type { NativeUiElement } from "@/src/main/computer/uia";
import { DEFAULT_APP_SETTLE_MS } from "@/src/main/computer/appProfiles";

const SESSION = "cs-11111111-2222-3333-4444-555555555555";

const WINDOW_ELEMENT: NativeUiElement = {
  nativeRef: "42.1",
  role: "Window",
  name: "窗口",
  enabled: true,
  focused: true,
  isPassword: false,
  bounds: { x: 0, y: 0, width: 1280, height: 800 },
  depth: 0,
};
const BUTTON_ELEMENT: NativeUiElement = {
  nativeRef: "42.2",
  role: "Button",
  name: "确定",
  enabled: true,
  focused: false,
  isPassword: false,
  bounds: { x: 100, y: 100, width: 120, height: 40 },
  depth: 1,
};

function windowRecord(overrides: Partial<NativeWindowRecord> = {}): NativeWindowRecord {
  return {
    hwnd: 101,
    pid: 1,
    title: "微信",
    appName: "wechat",
    bounds: { x: 0, y: 0, width: 1280, height: 800 },
    isActive: true,
    isOffscreen: false,
    zIndex: 0,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<DesktopObservationDeps> = {}) {
  const state = {
    now: 1_000_000,
    uiElements: [WINDOW_ELEMENT, BUTTON_ELEMENT] as NativeUiElement[],
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
    runGuiAction: vi.fn(async () => ({ ok: true, method: "uia-invoke" })),
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

describe("V2.4 运行时 — 观察返回应用画像", () => {
  it("微信窗口 → appProfile=im（label / blocked=false）", async () => {
    const { deps } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    const observation = await runtime.observe({ includeScreenshot: false });
    expect(observation.appProfile).toEqual({ id: "im", label: "即时通讯", blocked: false });
    expect(observation.warnings).not.toContain("app-profile-blocked");
  });

  it("密码管理器窗口 → blocked 画像 + app-profile-blocked 警告", async () => {
    const { deps, state } = makeDeps();
    state.windows = [windowRecord({ appName: "bitwarden", title: "Bitwarden" })];
    const runtime = new DesktopObservationRuntime(deps);
    const observation = await runtime.observe({ includeScreenshot: false });
    expect(observation.appProfile?.blocked).toBe(true);
    expect(observation.warnings).toContain("app-profile-blocked");
  });

  it("无画像窗口 → appProfile=null", async () => {
    const { deps, state } = makeDeps();
    state.windows = [windowRecord({ appName: "my-tool", title: "My Tool" })];
    const runtime = new DesktopObservationRuntime(deps);
    const observation = await runtime.observe({ includeScreenshot: false });
    expect(observation.appProfile).toBeNull();
  });

  it("session 状态透出 appProfile（Sidecar 可用）", async () => {
    const { deps } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    await runtime.observe({ includeScreenshot: false, sessionId: SESSION });
    const status = runtime.getSessionStatus({ sessionId: SESSION });
    expect(status.appProfile).toEqual({ id: "im", label: "即时通讯", blocked: false });
  });
});

describe("V2.4 运行时 — 应用画像参与风险", () => {
  it("受保护应用的动作 → blocked（ACTION_BLOCKED，不执行 native）", async () => {
    const { deps, state } = makeDeps();
    state.windows = [windowRecord({ appName: "1password", title: "1Password" })];
    const runtime = new DesktopObservationRuntime(deps);
    const observation = await runtime.observe({ includeScreenshot: false });
    const preparation = await runtime.prepareAction({
      action: "click",
      observationId: observation.observationId,
      target: { elementId: "el-2" },
      sessionId: SESSION,
    });
    expect(preparation.risk.level).toBe("blocked");
    expect(preparation.risk.reason).toContain("密码");

    await expect(
      runtime.action({
        action: "click",
        observationId: observation.observationId,
        target: { elementId: "el-2" },
        sessionId: SESSION,
      })
    ).rejects.toMatchObject({ code: "ACTION_BLOCKED" });
    expect(deps.runGuiAction).not.toHaveBeenCalled();
  });

  it("微信「转账」控件 → external（画像模式）", async () => {
    const { deps, state } = makeDeps();
    state.uiElements = [WINDOW_ELEMENT, { ...BUTTON_ELEMENT, name: "转账" }];
    const runtime = new DesktopObservationRuntime(deps);
    const observation = await runtime.observe({ includeScreenshot: false });
    const preparation = await runtime.prepareAction({
      action: "click",
      observationId: observation.observationId,
      target: { elementId: "el-2" },
      sessionId: SESSION,
    });
    expect(preparation.risk.level).toBe("external");
    expect(preparation.risk.reason).toContain("即时通讯");
  });
});

describe("V2.4 运行时 — 应用画像 settle", () => {
  it("浏览器动作 → 使用画像 settle（250ms，而不是默认 350ms）", async () => {
    const { deps, state } = makeDeps();
    state.windows = [windowRecord({ appName: "chrome", title: "Google" })];
    const runtime = new DesktopObservationRuntime(deps);
    const observation = await runtime.observe({ includeScreenshot: false });
    state.sleeps.length = 0;
    await runtime.action({
      action: "click",
      observationId: observation.observationId,
      target: { elementId: "el-2" },
      sessionId: SESSION,
    });
    expect(state.sleeps).toContain(250);
    expect(state.sleeps).not.toContain(DEFAULT_APP_SETTLE_MS);
  });

  it("未知应用动作 → 回退默认 settle（350ms）", async () => {
    const { deps, state } = makeDeps();
    state.windows = [windowRecord({ appName: "my-tool", title: "My Tool" })];
    const runtime = new DesktopObservationRuntime(deps);
    const observation = await runtime.observe({ includeScreenshot: false });
    state.sleeps.length = 0;
    await runtime.action({
      action: "click",
      observationId: observation.observationId,
      target: { elementId: "el-2" },
      sessionId: SESSION,
    });
    expect(state.sleeps).toContain(DEFAULT_APP_SETTLE_MS);
  });
});

describe("V2.4 运行时 — 启动应用使用画像 readyWait", () => {
  it("chrome → 首轮等待 600ms，后续按 settle 轮询", async () => {
    const { deps, state } = makeDeps();
    let listCalls = 0;
    const listWindows = vi.fn(async () => {
      listCalls += 1;
      return listCalls >= 3 ? [windowRecord({ appName: "chrome", title: "Google" })] : [];
    });
    state.windows = [];
    const runtime = new DesktopObservationRuntime({ ...deps, listWindows });
    const result = await runtime.openApplication({ app: "chrome", sessionId: SESSION });
    expect(result.launched).toBe(true);
    expect(result.windowId).toBeTruthy();
    expect(state.sleeps[0]).toBe(600);
    expect(state.sleeps[1]).toBe(250);
    expect(state.sleeps[2]).toBe(250);
  });

  it("未知应用（allowlist 内无画像）→ 首轮 400ms", async () => {
    const { deps, state } = makeDeps();
    let listCalls = 0;
    const listWindows = vi.fn(async () => {
      listCalls += 1;
      return listCalls >= 2 ? [windowRecord({ appName: "notepad", title: "记事本" })] : [];
    });
    state.windows = [];
    const runtime = new DesktopObservationRuntime({ ...deps, listWindows });
    await runtime.openApplication({ app: "notepad", sessionId: SESSION });
    expect(state.sleeps[0]).toBe(400);
  });
});
