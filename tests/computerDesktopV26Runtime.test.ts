// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { DesktopObservationRuntime, type DesktopObservationDeps } from "@/src/main/computer/runtime";
import { DesktopControlSessionStore } from "@/src/main/computer/session";
import type { NativeWindowRecord } from "@/src/main/computer/windows";
import type { NativeUiElement } from "@/src/main/computer/uia";

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
const BUTTON_ELEMENT: NativeUiElement = {
  nativeRef: "42.2",
  role: "Button",
  name: "发送",
  enabled: true,
  focused: false,
  isPassword: false,
  bounds: { x: 100, y: 100, width: 120, height: 40 },
  depth: 1,
};

function windowRecord(): NativeWindowRecord {
  return {
    hwnd: 101,
    pid: 1,
    title: "微信",
    appName: "wechat",
    bounds: { x: 0, y: 0, width: 1000, height: 800 },
    isActive: true,
    isOffscreen: false,
    zIndex: 0,
  };
}

function makeDeps(overrides: Partial<DesktopObservationDeps> = {}) {
  const state = { now: 1_000_000, sleeps: [] as number[] };
  const deps: DesktopObservationDeps = {
    platform: "win32",
    listWindows: async () => [windowRecord()],
    captureScreenshot: async () => null,
    inspectUiTree: async () => ({ elements: [WINDOW_ELEMENT, BUTTON_ELEMENT], truncated: false }),
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

describe("V2.6 Session 轨迹", () => {
  it("动作进入轨迹（含验证结果）；上限 40 丢弃最旧", () => {
    const store = new DesktopControlSessionStore();
    store.ensure(SESSION, 0);
    store.endObserve(
      SESSION,
      {
        appName: "wechat",
        windowTitle: "微信",
        uiSignature: "sig",
        appProfile: { id: "im", label: "即时通讯", blocked: false },
      },
      0
    );
    for (let i = 0; i < 45; i++) {
      store.recordTrajectoryStep(
        SESSION,
        { action: "click", targetLabel: `el-${i}`, risk: "normal", verificationPassed: i % 2 === 0 },
        i
      );
    }
    const trajectory = store.trajectorySnapshot(SESSION, 100);
    expect(trajectory?.steps).toHaveLength(40);
    expect(trajectory?.steps[0].targetLabel).toBe("el-5");
    expect(trajectory?.result).toBe("in-progress");
    expect(trajectory?.appLabel).toBe("即时通讯");
    expect(trajectory?.steps[0].verificationPassed).toBe(false); // 原始 i=5
    expect(trajectory?.steps[1].verificationPassed).toBe(true); // 原始 i=6
  });

  it("无轨迹 → null；终态映射 completed / failed / cancelled", () => {
    const store = new DesktopControlSessionStore();
    expect(store.trajectorySnapshot(SESSION, 0)).toBeNull();
    store.recordTrajectoryStep(SESSION, { action: "click", targetLabel: "x", risk: "normal", verificationPassed: null }, 0);
    store.complete(SESSION, 1);
    expect(store.trajectorySnapshot(SESSION, 2)?.result).toBe("completed");
    const other = new DesktopControlSessionStore();
    other.recordTrajectoryStep(SESSION, { action: "click", targetLabel: "x", risk: "normal", verificationPassed: null }, 0);
    other.cancel(SESSION, 1);
    expect(other.trajectorySnapshot(SESSION, 2)?.result).toBe("cancelled");
  });

  it("轨迹标签清洗（不含控制字符）", () => {
    const store = new DesktopControlSessionStore();
    store.recordTrajectoryStep(
      SESSION,
      { action: "type", targetLabel: "Edit\u0000「搜索」", risk: "normal", verificationPassed: null },
      0
    );
    expect(store.trajectorySnapshot(SESSION, 1)?.steps[0].targetLabel).toBe("Edit 「搜索」");
  });
});

describe("V2.6 运行时 — buildSkillDraft", () => {
  it("成功完成 + ≥3 步 → 返回草稿", async () => {
    const { deps } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    const observation = await runtime.observe({ includeScreenshot: false, sessionId: SESSION });
    for (let i = 0; i < 3; i++) {
      await runtime.action({
        action: "click",
        observationId: observation.observationId,
        target: { elementId: "el-2" },
        sessionId: SESSION,
      });
    }
    runtime.completeSession({ sessionId: SESSION });
    const result = runtime.buildSkillDraft({ sessionId: SESSION });
    expect(result.steps).toBe(3);
    expect(result.draft.name.startsWith("desktop-")).toBe(true);
    expect(result.draft.instructions).toContain("Button「发送」");
  });

  it("步骤不足 → INVALID_OPERATION", async () => {
    const { deps } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    const observation = await runtime.observe({ includeScreenshot: false, sessionId: SESSION });
    await runtime.action({
      action: "click",
      observationId: observation.observationId,
      target: { elementId: "el-2" },
      sessionId: SESSION,
    });
    runtime.completeSession({ sessionId: SESSION });
    expect(() => runtime.buildSkillDraft({ sessionId: SESSION })).toThrow(/步骤太少/);
  });

  it("未完成（进行中）→ INVALID_OPERATION", async () => {
    const { deps } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    const observation = await runtime.observe({ includeScreenshot: false, sessionId: SESSION });
    for (let i = 0; i < 3; i++) {
      await runtime.action({
        action: "click",
        observationId: observation.observationId,
        target: { elementId: "el-2" },
        sessionId: SESSION,
      });
    }
    expect(() => runtime.buildSkillDraft({ sessionId: SESSION })).toThrow(/成功完成/);
  });

  it("剪贴板动作进入轨迹（不含内容）", async () => {
    const { deps } = makeDeps({ readClipboard: () => "秘密内容" });
    const runtime = new DesktopObservationRuntime(deps);
    await runtime.action({ action: "clipboard_read", clipboardAllowed: true, sessionId: SESSION });
    const trajectory = runtime["sessions"].trajectorySnapshot(SESSION, 2);
    expect(trajectory?.steps[0].targetLabel).toBe("剪贴板（读取）");
    expect(JSON.stringify(trajectory)).not.toContain("秘密内容");
  });
});
