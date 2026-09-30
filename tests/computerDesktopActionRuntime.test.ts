// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  DesktopObservationRuntime,
  type DesktopObservationDeps,
} from "@/src/main/computer/runtime";
import {
  DesktopObservationStore,
  DesktopActionSessionRegistry,
  DesktopComputerIpcError,
  normalizeActionInput,
  DESKTOP_OBSERVATION_TTL_MS,
} from "@/src/main/computer/observation";
import {
  DesktopWindowRegistry,
  type NativeWindowRecord,
} from "@/src/main/computer/windows";
import type { NativeUiElement } from "@/src/main/computer/uia";
import {
  buildGuiActionScript,
  parseGuiActionResult,
} from "@/src/main/computer/guiAction";

const ELEMENT_WINDOW: NativeUiElement = {
  nativeRef: "42.1001",
  role: "Window",
  name: "Google",
  enabled: true,
  focused: true,
  isPassword: false,
  bounds: { x: 0, y: 0, width: 1280, height: 800 },
  depth: 0,
};
const ELEMENT_SEARCH: NativeUiElement = {
  nativeRef: "42.1002",
  role: "Edit",
  name: "搜索",
  enabled: true,
  focused: false,
  isPassword: false,
  bounds: { x: 100, y: 100, width: 400, height: 40 },
  depth: 2,
};
const ELEMENT_PASSWORD: NativeUiElement = {
  nativeRef: "42.1003",
  role: "Edit",
  name: "密码",
  enabled: true,
  focused: false,
  isPassword: true,
  bounds: { x: 100, y: 200, width: 400, height: 40 },
  depth: 2,
};

function windowRecord(overrides: Partial<NativeWindowRecord> = {}): NativeWindowRecord {
  return {
    hwnd: 101,
    pid: 4242,
    title: "Google",
    appName: "chrome",
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
    uiElements: [ELEMENT_WINDOW, ELEMENT_SEARCH, ELEMENT_PASSWORD],
    windows: [windowRecord()],
  };
  const runGuiAction = vi.fn(async () => ({ ok: true, method: "uia-invoke" }));
  const deps: DesktopObservationDeps = {
    platform: "win32",
    listWindows: async () => state.windows,
    captureScreenshot: async () => null,
    inspectUiTree: async () => ({ elements: state.uiElements, truncated: false }),
    probeUiAutomation: async () => true,
    getPrimaryScreenSize: () => ({ width: 1920, height: 1080 }),
    runGuiAction,
    sleep: async () => {},
    now: () => state.now,
    ...overrides,
  };
  return { deps, state, runGuiAction };
}

async function observeSearch(runtime: DesktopObservationRuntime) {
  const observation = await runtime.observe({ includeScreenshot: false });
  const search = observation.elements.find((element) => element.name === "搜索");
  const password = observation.elements.find((element) => element.name === "密码");
  return { observation, search: search!, password: password! };
}

describe("normalizeActionInput — malformed 动作输入 fail closed", () => {
  it("合法 click → 归一", () => {
    expect(
      normalizeActionInput({
        action: "click",
        observationId: "obs-11111111-2222-3333-4444-555555555555",
        target: { elementId: "el-3" },
        sessionId: "cs-11111111-2222-3333-4444-555555555555",
      })
    ).toMatchObject({ action: "click", target: { elementId: "el-3" } });
  });

  it.each([
    ["null", null],
    ["缺 action", { observationId: "obs-1" }],
    ["非法 action", { action: "drag" }],
    ["非 wait 缺 observationId", { action: "click", target: { elementId: "el-1" } }],
    ["click 缺 target", { action: "click", observationId: "obs-1" }],
    ["坐标越界", { action: "click", observationId: "obs-1", target: { normalized: { x: 1.5, y: 0.5 } } }],
    ["坐标未知字段", { action: "click", observationId: "obs-1", target: { normalized: { x: 0.5, y: 0.5, z: 1 } } }],
    ["target 双字段", { action: "click", observationId: "obs-1", target: { elementId: "el-1", normalized: { x: 0.1, y: 0.1 } } }],
    ["focus 带坐标", { action: "focus", observationId: "obs-1", target: { normalized: { x: 0.5, y: 0.5 } } }],
    ["type 缺 text", { action: "type", observationId: "obs-1", target: { elementId: "el-1" } }],
    ["type 夹带 key", { action: "type", observationId: "obs-1", text: "x", key: "enter" }],
    ["key 缺 key", { action: "key", observationId: "obs-1" }],
    ["scroll 越界", { action: "scroll", observationId: "obs-1", scroll: 42 }],
    ["wait 越界", { action: "wait", wait: 99 }],
    ["wait 带 target", { action: "wait", wait: 300, target: { elementId: "el-1" } }],
    ["未知字段", { action: "click", observationId: "obs-1", target: { elementId: "el-1" }, hwnd: 1 }],
    ["非法 sessionId", { action: "wait", wait: 300, sessionId: "session-1" }],
  ])("%s → INVALID_OPERATION", (_label, input) => {
    try {
      normalizeActionInput(input);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(DesktopComputerIpcError);
      expect((err as DesktopComputerIpcError).code).toBe("INVALID_OPERATION");
    }
  });
});

describe("DesktopObservationRuntime.prepareAction — 观察强绑定", () => {
  it("元素存在且 bounds 一致 → 风险事实 + 脱敏 target", async () => {
    const { deps } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    const { observation, search } = await observeSearch(runtime);
    const preparation = await runtime.prepareAction({
      action: "click",
      observationId: observation.observationId,
      target: { elementId: search.elementId },
    });
    expect(preparation.risk.level).toBe("normal");
    expect(preparation.target.kind).toBe("element");
    expect(preparation.target.role).toBe("Edit");
    expect(preparation.target.name).toBe("搜索");
    expect(preparation.target.targetLabel).toContain("Edit");
    expect(preparation.requiresObservation).toBe(true);
    // 绝不泄漏 native 标识
    expect(JSON.stringify(preparation)).not.toContain("42.1002");
    expect(JSON.stringify(preparation)).not.toMatch(/"hwnd"|"pid"|"nativeRef"/);
  });

  it("observation 过期 → STALE_OBSERVATION", async () => {
    const { deps, state } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    const { observation, search } = await observeSearch(runtime);
    state.now += DESKTOP_OBSERVATION_TTL_MS + 1;
    await expect(
      runtime.prepareAction({
        action: "click",
        observationId: observation.observationId,
        target: { elementId: search.elementId },
      })
    ).rejects.toMatchObject({ code: "STALE_OBSERVATION" });
  });

  it("对话切到其它窗口 → STALE_OBSERVATION", async () => {
    const { deps, state } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    const { observation, search } = await observeSearch(runtime);
    state.windows = [windowRecord({ hwnd: 202, pid: 9999, title: "QQ", appName: "QQ", isActive: true })];
    await expect(
      runtime.prepareAction({
        action: "click",
        observationId: observation.observationId,
        target: { elementId: search.elementId },
      })
    ).rejects.toMatchObject({ code: "STALE_OBSERVATION" });
  });

  it("元素消失（重新检查不存在）→ STALE_OBSERVATION", async () => {
    const { deps, state } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    const { observation, search } = await observeSearch(runtime);
    state.uiElements = [ELEMENT_WINDOW];
    await expect(
      runtime.prepareAction({
        action: "click",
        observationId: observation.observationId,
        target: { elementId: search.elementId },
      })
    ).rejects.toMatchObject({ code: "STALE_OBSERVATION" });
  });

  it("bounds 明显变化 → STALE_OBSERVATION", async () => {
    const { deps, state } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    const { observation, search } = await observeSearch(runtime);
    state.uiElements = [
      ELEMENT_WINDOW,
      { ...ELEMENT_SEARCH, bounds: { x: 300, y: 400, width: 400, height: 40 } },
    ];
    await expect(
      runtime.prepareAction({
        action: "click",
        observationId: observation.observationId,
        target: { elementId: search.elementId },
      })
    ).rejects.toMatchObject({ code: "STALE_OBSERVATION" });
  });

  it("微小平移（≤24px）→ 允许（不误报 stale）", async () => {
    const { deps, state } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    const { observation, search } = await observeSearch(runtime);
    state.uiElements = [
      ELEMENT_WINDOW,
      { ...ELEMENT_SEARCH, bounds: { x: 110, y: 108, width: 400, height: 40 } },
    ];
    const preparation = await runtime.prepareAction({
      action: "click",
      observationId: observation.observationId,
      target: { elementId: search.elementId },
    });
    expect(preparation.risk.level).toBe("normal");
  });

  it("密码字段 type → blocked（Main 层再次拦截）", async () => {
    const { deps } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    const { observation, password } = await observeSearch(runtime);
    const preparation = await runtime.prepareAction({
      action: "type",
      observationId: observation.observationId,
      target: { elementId: password.elementId },
      text: "secret",
    });
    expect(preparation.risk.level).toBe("blocked");
  });

  it("发送按钮 click → external（高风险）", async () => {
    const { deps, state } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    state.uiElements = [
      ELEMENT_WINDOW,
      { ...ELEMENT_SEARCH, name: "发送", role: "Button" },
    ];
    const observation = await runtime.observe({ includeScreenshot: false });
    const button = observation.elements.find((e) => e.name === "发送")!;
    const preparation = await runtime.prepareAction({
      action: "click",
      observationId: observation.observationId,
      target: { elementId: button.elementId },
    });
    expect(preparation.risk.level).toBe("external");
    expect(preparation.risk.reason).toContain("发送");
  });

  it("坐标回退 → kind=coordinates + external", async () => {
    const { deps } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    const { observation } = await observeSearch(runtime);
    const preparation = await runtime.prepareAction({
      action: "click",
      observationId: observation.observationId,
      target: { normalized: { x: 0.25, y: 0.5 } },
    });
    expect(preparation.target.kind).toBe("coordinates");
    expect(preparation.risk.level).toBe("external");
  });

  it("wait → 无需 observation", async () => {
    const { deps } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    const preparation = await runtime.prepareAction({ action: "wait", wait: 300 });
    expect(preparation.requiresObservation).toBe(false);
    expect(preparation.observationId).toBeNull();
  });
});

describe("DesktopObservationRuntime.action — 执行 + 自动重新观察", () => {
  it("click：UIA 语义执行 + 新 observation + uiChanged", async () => {
    const { deps, runGuiAction, state } = makeDeps();
    // 模拟点击后 UI 变化（出现结果元素）
    const mutableRun = vi.fn(async () => {
      state.uiElements = [
        ELEMENT_WINDOW,
        ELEMENT_SEARCH,
        { ...ELEMENT_SEARCH, nativeRef: "42.2001", name: "ClassFlow - 搜索结果", bounds: { x: 10, y: 300, width: 800, height: 200 } },
      ];
      return { ok: true, method: "uia-invoke" };
    });
    const runtime = new DesktopObservationRuntime({ ...deps, runGuiAction: mutableRun });
    const { observation, search } = await observeSearch(runtime);
    const result = await runtime.action({
      action: "click",
      observationId: observation.observationId,
      target: { elementId: search.elementId },
    });
    expect(result.actionResult.method).toBe("uia-invoke");
    expect(result.newObservationId).toMatch(/^obs-/);
    expect(result.observation).not.toBeNull();
    expect(result.uiChanged).toBe(true);
    expect(result.changedWindow).toBe(false);
    expect(result.newObservationId).not.toBe(observation.observationId);

    const config = mutableRun.mock.calls[0][0];
    expect(config.action).toBe("click");
    expect(config.nativeRef).toBe("42.1002");
    expect(config.expectedBounds).toEqual({ x: 100, y: 100, width: 400, height: 40 });
    // native 标识不进入返回值
    expect(JSON.stringify(result)).not.toMatch(/"hwnd"|"nativeRef"|"42\.1002"/);
    void runGuiAction;
  });

  it("key：VK 序列传给输入适配器", async () => {
    const { deps, runGuiAction } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    const { observation } = await observeSearch(runtime);
    await runtime.action({
      action: "key",
      observationId: observation.observationId,
      key: "enter",
    });
    expect(runGuiAction.mock.calls[0][0].vk).toEqual([0x0d]);
  });

  it("坐标回退：normalized → 绝对像素（observation 基准）", async () => {
    const { deps, runGuiAction } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    const { observation } = await observeSearch(runtime);
    await runtime.action({
      action: "click",
      observationId: observation.observationId,
      target: { normalized: { x: 0.5, y: 0.25 } },
    });
    const config = runGuiAction.mock.calls[0][0];
    expect(config.nativeRef).toBeNull();
    expect(config.point).toEqual({ x: 640, y: 200 });
  });

  it("blocked（密码字段）→ ACTION_BLOCKED 且不执行输入", async () => {
    const { deps, runGuiAction } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    const { observation, password } = await observeSearch(runtime);
    await expect(
      runtime.action({
        action: "type",
        observationId: observation.observationId,
        target: { elementId: password.elementId },
        text: "secret",
      })
    ).rejects.toMatchObject({ code: "ACTION_BLOCKED" });
    expect(runGuiAction).not.toHaveBeenCalled();
  });

  it("执行期 stale（bounds-changed / element-missing）→ STALE_OBSERVATION", async () => {
    const { deps } = makeDeps({
      runGuiAction: async () => ({ ok: false, reason: "bounds-changed" }),
    });
    const runtime = new DesktopObservationRuntime(deps);
    const { observation, search } = await observeSearch(runtime);
    await expect(
      runtime.action({
        action: "click",
        observationId: observation.observationId,
        target: { elementId: search.elementId },
      })
    ).rejects.toMatchObject({ code: "STALE_OBSERVATION" });
  });

  it("元素 disabled → ACTION_BLOCKED", async () => {
    const { deps } = makeDeps({
      runGuiAction: async () => ({ ok: false, reason: "element-disabled" }),
    });
    const runtime = new DesktopObservationRuntime(deps);
    const { observation, search } = await observeSearch(runtime);
    await expect(
      runtime.action({
        action: "click",
        observationId: observation.observationId,
        target: { elementId: search.elementId },
      })
    ).rejects.toMatchObject({ code: "ACTION_BLOCKED" });
  });

  it("wait 不执行输入、不重新观察", async () => {
    const { deps, runGuiAction } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    const result = await runtime.action({ action: "wait", wait: 200 });
    expect(result.actionResult.method).toBe("wait");
    expect(result.observation).toBeNull();
    expect(result.newObservationId).toBeNull();
    expect(runGuiAction).not.toHaveBeenCalled();
  });
});

describe("Emergency Stop — cancelActions", () => {
  it("取消后清空 session observation，并拒绝后续 observe/action", async () => {
    const { deps } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    const sessionId = "cs-11111111-2222-3333-4444-555555555555";
    const observation = await runtime.observe({ includeScreenshot: false, sessionId });
    expect(runtime.stats().observations).toBe(1);

    const cancelled = runtime.cancelActions({ sessionId });
    expect(cancelled.ok).toBe(true);
    expect(cancelled.cancelled).toBe(1);
    expect(runtime.stats().observations).toBe(0);

    await expect(
      runtime.observe({ includeScreenshot: false, sessionId })
    ).rejects.toMatchObject({ code: "CANCELLED" });
    await expect(
      runtime.action({
        action: "click",
        observationId: observation.observationId,
        target: { elementId: "el-1" },
        sessionId,
      })
    ).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("其它 session 不受影响", async () => {
    const { deps } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    const sessionA = "cs-11111111-2222-3333-4444-555555555555";
    const sessionB = "cs-99999999-8888-7777-6666-555555555555";
    await runtime.observe({ includeScreenshot: false, sessionId: sessionA });
    const observationB = await runtime.observe({ includeScreenshot: false, sessionId: sessionB });
    runtime.cancelActions({ sessionId: sessionA });
    const refreshed = await runtime.observe({ includeScreenshot: false, sessionId: sessionB });
    expect(refreshed.observationId).not.toBe(observationB.observationId);
    // session B 的旧 observation 仍保留 + 新 observation（session A 已清空）
    expect(runtime.stats().observations).toBe(2);
  });

  it("malformed cancel 输入 → INVALID_OPERATION", () => {
    const { deps } = makeDeps();
    const runtime = new DesktopObservationRuntime(deps);
    expect(() => runtime.cancelActions(null)).toThrow(DesktopComputerIpcError);
    expect(() => runtime.cancelActions({ sessionId: "nope" })).toThrow(DesktopComputerIpcError);
    expect(() => runtime.cancelActions({ sessionId: "cs-11111111-2222-3333-4444-555555555555", extra: 1 })).toThrow(
      DesktopComputerIpcError
    );
  });
});

describe("GUI Action 脚本构建 / 结果解析", () => {
  it("配置经 base64 注入，恶意文本不破坏脚本", () => {
    const text = "'; Remove-Item C:\\ -Recurse; '@ \u0000";
    const script = buildGuiActionScript({
      hwnd: 101,
      nativeRef: "42.1002",
      expectedBounds: { x: 1, y: 2, width: 3, height: 4 },
      action: "type",
      text,
    });
    const match = script.match(/FromBase64String\('([^']+)'\)/);
    expect(match).toBeTruthy();
    const decoded = Buffer.from(match![1], "base64").toString("utf8");
    const config = JSON.parse(decoded) as { text: string };
    expect(config.text).toBe(text);
    expect(script).not.toContain("Remove-Item C:");
  });

  it("脚本包含 UIA 语义优先 + bounds 容差常量", () => {
    const script = buildGuiActionScript({ hwnd: 1, nativeRef: null, action: "click" });
    expect(script).toContain("InvokePattern");
    expect(script).toContain("SelectionItemPattern");
    expect(script).toContain("ValuePattern");
    expect(script).toContain("bounds-changed");
    expect(script).toContain("window-not-foreground");
    expect(script).toContain("SetProcessDPIAware");
  });

  it("parseGuiActionResult fail closed", () => {
    expect(parseGuiActionResult({ ok: true, method: "uia-invoke" })).toEqual({ ok: true, method: "uia-invoke" });
    expect(parseGuiActionResult({ ok: true })).toEqual({ ok: false, reason: "invalid-result" });
    expect(parseGuiActionResult(null)).toEqual({ ok: false, reason: "invalid-result" });
    expect(parseGuiActionResult({ ok: false, reason: "bounds-changed" })).toEqual({
      ok: false,
      reason: "bounds-changed",
    });
  });

  it("后台模式：config 透传 background；结果回显 background；新 reason 原样透传", () => {
    const script = buildGuiActionScript({ hwnd: 7, nativeRef: "1.2", action: "click", background: true });
    const match = script.match(/FromBase64String\('([^']+)'\)/);
    expect(match).toBeTruthy();
    const config = JSON.parse(Buffer.from(match![1], "base64").toString("utf8")) as {
      background?: boolean;
    };
    expect(config.background).toBe(true);
    // 脚本语义：后台跳过前台化、最小化直接失败、非语义动作 foreground-required
    expect(script).toContain("window-minimized");
    expect(script).toContain("foreground-required");
    expect(script).toContain("verify-failed");
    expect(parseGuiActionResult({ ok: true, method: "uia-setvalue", background: true })).toEqual({
      ok: true,
      method: "uia-setvalue",
      background: true,
    });
    // 非布尔 background 不透传（fail closed）
    expect(parseGuiActionResult({ ok: true, method: "uia-invoke", background: "yes" })).toEqual({
      ok: true,
      method: "uia-invoke",
    });
    expect(parseGuiActionResult({ ok: false, reason: "foreground-required", background: true })).toEqual({
      ok: false,
      reason: "foreground-required",
      background: true,
    });
  });
});

describe("Main 安全边界 — 无 unrestricted input / clipboard", () => {
  it("gui 模块与 main computer runtime 不 import robotjs / SendKeys / clipboard", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const files = [
      "lib/ai/computer/gui/executor.ts",
      "lib/ai/computer/gui/risk.ts",
      "lib/ai/computer/gui/keymap.ts",
      "lib/ai/computer/gui/observation.ts",
      "src/main/computer/runtime.ts",
      "src/main/computer/guiAction.ts",
      "src/main/computer/observation.ts",
      "src/main/computer/ipc.ts",
    ];
    for (const file of files) {
      const source = readFileSync(join(process.cwd(), file), "utf8").toLowerCase();
      for (const needle of ["robotjs", "sendkeys", "clipboard.write", "shell.openexternal", "node-pty"]) {
        expect(source, `${file} 不应包含 ${needle}`).not.toContain(needle);
      }
    }
  });
});
