// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  DesktopControlSessionStore,
  DESKTOP_SESSION_LIMITS,
  DesktopSessionGuardError,
} from "@/src/main/computer/session";
import {
  buildAppResolveScript,
  desktopAppLabel,
  normalizeDesktopAppId,
  parseAppResolveResult,
} from "@/src/main/computer/apps";
import {
  DesktopObservationRuntime,
  type DesktopObservationDeps,
} from "@/src/main/computer/runtime";
import type { NativeWindowRecord } from "@/src/main/computer/windows";
import type { NativeUiElement } from "@/src/main/computer/uia";

const SESSION = "cs-11111111-2222-3333-4444-555555555555";

function guardCode(fn: () => void): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    if (err instanceof DesktopSessionGuardError) return err.code;
    throw err;
  }
}

describe("DesktopControlSessionStore — 生命周期与守卫", () => {
  it("ensure → idle；observe/action 状态迁移", () => {
    const store = new DesktopControlSessionStore();
    expect(store.ensure(SESSION, 0).state).toBe("idle");
    store.beginObserve(SESSION, 0);
    expect(store.get(SESSION, 0)?.state).toBe("observing");
    expect(store.get(SESSION, 0)?.observations).toBe(1);
    store.endObserve(SESSION, { appName: "chrome", windowTitle: "Google", uiSignature: "s1" }, 0);
    expect(store.get(SESSION, 0)?.state).toBe("idle");

    store.beginAction(SESSION, { fingerprint: "click:el-1", actionLabel: "点击 搜索", appName: "chrome", windowTitle: "Google" }, 0);
    expect(store.get(SESSION, 0)?.state).toBe("acting");
    store.endAction(SESSION, { beforeUiSignature: "s1", newUiSignature: "s2", ok: true, actionFingerprint: "click:el-1" }, 0);
    expect(store.get(SESSION, 0)?.state).toBe("idle");
    expect(store.get(SESSION, 0)?.actions).toBe(1);
  });

  it("pause / resume / cancel / complete", () => {
    const store = new DesktopControlSessionStore();
    store.beginObserve(SESSION, 0);
    store.pause(SESSION, 0);
    expect(store.get(SESSION, 0)?.state).toBe("paused");
    expect(guardCode(() => store.beginObserve(SESSION, 0))).toBe("SESSION_PAUSED");
    store.resume(SESSION, 0);
    expect(store.get(SESSION, 0)?.state).toBe("idle");
    store.beginObserve(SESSION, 0);
    store.complete(SESSION, 0);
    expect(store.get(SESSION, 0)?.state).toBe("completed");
    // terminal 不可复活
    store.resume(SESSION, 0);
    expect(store.get(SESSION, 0)?.state).toBe("completed");
  });

  it("cancel 后所有操作被拒绝（CANCELLED）", () => {
    const store = new DesktopControlSessionStore();
    store.cancel(SESSION, 0);
    expect(store.isCancelled(SESSION)).toBe(true);
    expect(guardCode(() => store.beginObserve(SESSION, 0))).toBe("SESSION_CANCELLED");
    expect(
      guardCode(() =>
        store.beginAction(SESSION, { fingerprint: "click", actionLabel: "点击", appName: null, windowTitle: null }, 0)
      )
    ).toBe("SESSION_CANCELLED");
  });

  it("观察/动作次数上限", () => {
    const store = new DesktopControlSessionStore();
    for (let i = 0; i < DESKTOP_SESSION_LIMITS.maxObservations; i++) {
      store.beginObserve(SESSION, 0);
      store.endObserve(SESSION, { appName: null, windowTitle: null, uiSignature: `s${i}` }, 0);
    }
    expect(guardCode(() => store.beginObserve(SESSION, 0))).toBe("SESSION_LIMIT_REACHED");
  });

  it("repeated-action detection（连续相同动作指纹）", () => {
    const store = new DesktopControlSessionStore();
    for (let i = 0; i <= DESKTOP_SESSION_LIMITS.maxRepeatedActions; i++) {
      const code = guardCode(() =>
        store.beginAction(SESSION, { fingerprint: "click:el-1", actionLabel: "点击", appName: null, windowTitle: null }, 0)
      );
      if (i < DESKTOP_SESSION_LIMITS.maxRepeatedActions) {
        expect(code).toBeNull();
        store.endAction(SESSION, { beforeUiSignature: null, newUiSignature: null, ok: true, actionFingerprint: "click:el-1" }, 0);
      } else {
        expect(code).toBe("REPEATED_ACTION");
      }
    }
  });

  it("no-progress detection（UI 指纹连续不变）", () => {
    const store = new DesktopControlSessionStore();
    let detected: string | null = null;
    for (let i = 0; i <= DESKTOP_SESSION_LIMITS.maxNoProgress; i++) {
      store.beginAction(SESSION, { fingerprint: `scroll:${i}`, actionLabel: "滚动", appName: null, windowTitle: null }, 0);
      detected = guardCode(() =>
        store.endAction(SESSION, { beforeUiSignature: "same", newUiSignature: "same", ok: true, actionFingerprint: `scroll:${i}` }, 0)
      );
      if (detected) break;
    }
    expect(detected).toBe("NO_PROGRESS");
    expect(store.get(SESSION, 0)?.state).toBe("failed");
  });

  it("UI 变化 → no-progress 归零", () => {
    const store = new DesktopControlSessionStore();
    store.beginAction(SESSION, { fingerprint: "click:1", actionLabel: "点击", appName: null, windowTitle: null }, 0);
    store.endAction(SESSION, { beforeUiSignature: "a", newUiSignature: "b", ok: true, actionFingerprint: "click:1" }, 0);
    store.beginAction(SESSION, { fingerprint: "click:1", actionLabel: "点击", appName: null, windowTitle: null }, 0);
    expect(
      guardCode(() => store.endAction(SESSION, { beforeUiSignature: "b", newUiSignature: "b", ok: true, actionFingerprint: "click:1" }, 0))
    ).toBeNull();
    expect(store.get(SESSION, 0)?.state).toBe("idle");
  });

  it("时长上限 → SESSION_LIMIT_REACHED", () => {
    const store = new DesktopControlSessionStore();
    store.ensure(SESSION, 0);
    expect(guardCode(() => store.beginObserve(SESSION, DESKTOP_SESSION_LIMITS.maxDurationMs + 1))).toBe(
      "SESSION_LIMIT_REACHED"
    );
  });

  it("sweep 清理终态 session", () => {
    const store = new DesktopControlSessionStore();
    store.cancel(SESSION, 0);
    expect(store.sweep(DESKTOP_SESSION_LIMITS.terminalTtlMs + 1)).toBe(1);
    expect(store.size()).toBe(0);
  });
});

describe("apps allowlist — logical app id 解析", () => {
  it.each([
    ["chrome", "chrome"],
    ["Chrome", "chrome"],
    ["google chrome", "chrome"],
    ["word", "word"],
    ["微信", "wechat"],
    ["wechat", "wechat"],
    ["notepad", "notepad"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeDesktopAppId(input)).toBe(expected);
  });

  it.each(["C:\\Program Files\\Google\\Chrome\\chrome.exe", "/usr/bin/chrome", "..\\evil", "unknown-app", ""])(
    "拒绝 %j",
    (input) => {
      expect(normalizeDesktopAppId(input)).toBeNull();
    }
  );

  it("parseAppResolveResult fail closed", () => {
    expect(parseAppResolveResult({ kind: "exe", command: "C:\\x.exe" })).toEqual({
      kind: "exe",
      command: "C:\\x.exe",
    });
    expect(parseAppResolveResult({ kind: "appsFolder", appId: "Chrome", label: "Chrome" })).toMatchObject({
      kind: "appsFolder",
      appId: "Chrome",
    });
    expect(parseAppResolveResult(null)).toEqual({ kind: "none" });
    expect(parseAppResolveResult({ kind: "exe" })).toEqual({ kind: "none" });
  });

  it("解析脚本内只包含 allowlist alias（base64；无模型输入）", () => {
    const script = buildAppResolveScript("chrome");
    const match = script.match(/FromBase64String\('([^']+)'\)/);
    expect(match).toBeTruthy();
    const aliases = JSON.parse(Buffer.from(match![1], "base64").toString("utf8")) as string[];
    expect(aliases).toContain("chrome");
    expect(aliases.length).toBeGreaterThan(0);
  });

  it("label 可读", () => {
    expect(desktopAppLabel("chrome")).toBe("Chrome");
    expect(desktopAppLabel("wechat")).toBe("微信");
  });
});

/* ---------------- Runtime Phase 3：多窗口 / 应用 / 守卫集成 ---------------- */

const ELEMENT_WINDOW: NativeUiElement = {
  nativeRef: "42.1",
  role: "Window",
  name: "Google",
  enabled: true,
  focused: true,
  isPassword: false,
  bounds: { x: 0, y: 0, width: 1280, height: 800 },
  depth: 0,
};
const ELEMENT_SEARCH: NativeUiElement = {
  nativeRef: "42.2",
  role: "Edit",
  name: "搜索",
  enabled: true,
  focused: false,
  isPassword: false,
  bounds: { x: 100, y: 100, width: 400, height: 40 },
  depth: 1,
};

function windowRecord(overrides: Partial<NativeWindowRecord> = {}): NativeWindowRecord {
  return {
    hwnd: 101,
    pid: 1,
    title: "Google",
    appName: "chrome",
    bounds: { x: 0, y: 0, width: 1280, height: 800 },
    isActive: true,
    isOffscreen: false,
    zIndex: 0,
    ...overrides,
  };
}

function makeRuntimeDeps(overrides: Partial<DesktopObservationDeps> = {}) {
  const state = {
    now: 1_000,
    elements: [ELEMENT_WINDOW, ELEMENT_SEARCH],
    windows: [windowRecord()],
    activated: [] as number[],
    launched: [] as string[],
  };
  const deps: DesktopObservationDeps = {
    platform: "win32",
    listWindows: async () => state.windows,
    captureScreenshot: async () => null,
    inspectUiTree: async () => ({ elements: state.elements, truncated: false }),
    probeUiAutomation: async () => true,
    getPrimaryScreenSize: () => ({ width: 1920, height: 1080 }),
    runGuiAction: vi.fn(async () => ({ ok: true, method: "uia-invoke" })),
    activateWindow: async (hwnd) => {
      state.activated.push(hwnd);
      return true;
    },
    resolveApp: async (appId) => ({ kind: "appsFolder", appId: `Fake.${appId}`, label: appId }),
    launchApp: (resolved) => {
      if (resolved.kind === "appsFolder") state.launched.push(resolved.appId);
      return true;
    },
    sleep: async () => {},
    now: () => state.now,
    ...overrides,
  };
  return { deps, state };
}

describe("DesktopObservationRuntime — Phase 3 多窗口 / 应用 / Session", () => {
  it("listWindows 返回 z-order / focusedWindow / activeApplication", async () => {
    const { deps, state } = makeRuntimeDeps();
    state.windows = [
      windowRecord({ hwnd: 101, title: "Google", zIndex: 0, isActive: false }),
      windowRecord({ hwnd: 202, title: "微信", appName: "wechat", zIndex: 1, isActive: true }),
    ];
    const runtime = new DesktopObservationRuntime(deps);
    const list = await runtime.listWindows({});
    expect(list.windows).toHaveLength(2);
    expect(list.windows[0].zOrder).toBe(0);
    expect(list.activeApplication).toBe("wechat");
    expect(list.focusedWindowId).toMatch(/^win-/);
    // native 标识不出现
    expect(JSON.stringify(list)).not.toMatch(/"hwnd"|"pid"|"202"/);
  });

  it("observe 记录 session 观察数；action 记录动作数并检测 repeated/no-progress", async () => {
    const { deps } = makeRuntimeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    const observation = await runtime.observe({ includeScreenshot: false, sessionId: SESSION });
    const target = observation.elements.find((e) => e.name === "搜索")!;
    // 连续相同动作：第 4 次触发 REPEATED_ACTION（maxRepeatedActions=3）
    for (let i = 0; i < 3; i++) {
      await runtime.action({
        action: "click",
        observationId: observation.observationId,
        target: { elementId: target.elementId },
        sessionId: SESSION,
      });
    }
    await expect(
      runtime.action({
        action: "click",
        observationId: observation.observationId,
        target: { elementId: target.elementId },
        sessionId: SESSION,
      })
    ).rejects.toMatchObject({ code: "REPEATED_ACTION" });
    const status = runtime.getSessionStatus({ sessionId: SESSION });
    expect(status.actions).toBe(3);
    expect(status.observations).toBeGreaterThanOrEqual(3);
  });

  it("no-progress：UI 指纹不变连续超过阈值 → NO_PROGRESS", async () => {
    const { deps } = makeRuntimeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    const observation = await runtime.observe({ includeScreenshot: false, sessionId: SESSION });
    const target = observation.elements.find((e) => e.name === "搜索")!;
    const codes: string[] = [];
    for (let i = 0; i < 6; i++) {
      try {
        await runtime.action({
          action: "type",
          observationId: observation.observationId,
          target: { elementId: target.elementId },
          text: `q${i}`,
          sessionId: SESSION,
        });
      } catch (err) {
        codes.push((err as { code: string }).code);
        break;
      }
    }
    expect(codes).toContain("NO_PROGRESS");
  });

  it("pause → SESSION_PAUSED；resume 后可继续", async () => {
    const { deps } = makeRuntimeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    await runtime.observe({ includeScreenshot: false, sessionId: SESSION });
    runtime.pauseSession({ sessionId: SESSION });
    await expect(runtime.observe({ includeScreenshot: false, sessionId: SESSION })).rejects.toMatchObject({
      code: "SESSION_PAUSED",
    });
    runtime.resumeSession({ sessionId: SESSION });
    const observation = await runtime.observe({ includeScreenshot: false, sessionId: SESSION });
    expect(observation.observationId).toMatch(/^obs-/);
  });

  it("activateWindow 调用 native adapter 并返回 opaque 事实", async () => {
    const { deps, state } = makeRuntimeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    const observation = await runtime.observe({ includeScreenshot: false });
    const result = await runtime.activateWindow({ windowId: observation.windowId!, sessionId: SESSION });
    expect(result.activated).toBe(true);
    expect(result.appName).toBe("chrome");
    expect(state.activated).toEqual([101]);
    expect(JSON.stringify(result)).not.toMatch(/"hwnd"|"101"/);
  });

  it("activateWindow 未知 windowId → STALE_OBSERVATION", async () => {
    const { deps } = makeRuntimeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    await expect(runtime.activateWindow({ windowId: "win-deadbeef" })).rejects.toMatchObject({
      code: "STALE_OBSERVATION",
    });
  });

  it("openApplication：allowlist 外 → APP_NOT_FOUND（不启动）", async () => {
    const { deps, state } = makeRuntimeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    await expect(
      runtime.openApplication({ app: "C:\\evil\\evil.exe" })
    ).rejects.toMatchObject({ code: "INVALID_OPERATION" });
    await expect(runtime.openApplication({ app: "unknownapp" })).rejects.toMatchObject({
      code: "APP_NOT_FOUND",
    });
    expect(state.launched).toEqual([]);
  });

  it("openApplication：chrome → 启动 + 等待窗口出现返回 opaque windowId", async () => {
    const { deps, state } = makeRuntimeDeps({
      listWindows: async () => [windowRecord()],
    });
    const runtime = new DesktopObservationRuntime(deps);
    const result = await runtime.openApplication({ app: "chrome", sessionId: SESSION });
    expect(result.launched).toBe(true);
    expect(result.windowId).toMatch(/^win-/);
    expect(state.launched.length).toBe(1);
    expect(JSON.stringify(result)).not.toMatch(/"hwnd"|"101"|\.exe/i);
  });

  it("cancelActions 清空 observation 且取消 session 状态", async () => {
    const { deps } = makeRuntimeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    await runtime.observe({ includeScreenshot: false, sessionId: SESSION });
    const result = runtime.cancelActions({ sessionId: SESSION });
    expect(result.cancelled).toBe(1);
    expect(runtime.getSessionStatus({ sessionId: SESSION }).state).toBe("cancelled");
  });
});
