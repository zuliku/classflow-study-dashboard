// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import {
  getClassFlowDesktopComputerBridge,
  getClassFlowDesktopComputerSessionBridge,
  hasClassFlowDesktopComputer,
  hasClassFlowDesktopComputerAction,
  hasClassFlowDesktopComputerSession,
} from "@/lib/desktop/bridge";
import { ClassFlowDesktopComputerBridge } from "@/lib/desktop/types";

const filesystemStub = {
  pickDirectory: async () => null,
  getGrantStatus: async () => ({ status: "granted" as const }),
  forgetGrant: async () => undefined,
  list: async () => [],
  stat: async () => null,
  readText: async () => "",
  readBytes: async () => new Uint8Array(),
  readTextPrefix: async () => ({ text: "", truncated: false }),
  createDirectory: async () => "created" as const,
  writeText: async () => undefined,
  writeBytes: async () => undefined,
  remove: async () => undefined,
  move: async () => undefined,
};

function computerStub(): ClassFlowDesktopComputerBridge {
  return {
    version: 1,
    capabilities: async () => ({
      available: true,
      platform: "windows",
      screenshot: true,
      uiAutomation: true,
    }),
    observe: async () => ({
      observationId: "obs-test",
      target: "active-window",
      appName: "notepad",
      windowTitle: "无标题 - 记事本",
      windowId: "win-3f9a2c1b4d5e",
      viewport: { width: 1280, height: 720 },
      windows: [
        { windowId: "win-3f9a2c1b4d5e", title: "无标题 - 记事本", appName: "notepad", active: true },
      ],
      windowsTruncated: false,
      elements: [],
      elementCount: 0,
      elementsTruncated: false,
      screenshot: null,
      warnings: [],
      uiTreeRevision: 1,
      capturedAt: "2026-09-21T00:00:00.000Z",
    }),
  };
}

function installBridge(withComputer: boolean) {
  (window as unknown as { classflowDesktop?: unknown }).classflowDesktop = {
    version: 1,
    platform: "windows",
    filesystem: filesystemStub,
    ...(withComputer ? { computer: computerStub() } : {}),
  };
}

afterEach(() => {
  delete (window as unknown as { classflowDesktop?: unknown }).classflowDesktop;
});

describe("getClassFlowDesktopComputerBridge / hasClassFlowDesktopComputer", () => {
  it("无 Bridge → null / false（Web runtime）", () => {
    expect(getClassFlowDesktopComputerBridge()).toBeNull();
    expect(hasClassFlowDesktopComputer()).toBe(false);
  });

  it("filesystem-only Bridge（旧 Desktop）→ computer 不可用但不影响整体 Bridge", () => {
    installBridge(false);
    expect(getClassFlowDesktopComputerBridge()).toBeNull();
    expect(hasClassFlowDesktopComputer()).toBe(false);
  });

  it("完整 computer capability → 可用", () => {
    installBridge(true);
    const bridge = getClassFlowDesktopComputerBridge();
    expect(bridge).not.toBeNull();
    expect(hasClassFlowDesktopComputer()).toBe(true);
    expect(typeof bridge?.observe).toBe("function");
    expect(typeof bridge?.capabilities).toBe("function");
  });

  it("未知 computer version → null（不做猜测兼容）", () => {
    installBridge(true);
    const desktop = (window as unknown as { classflowDesktop: { computer: { version: number } } }).classflowDesktop;
    desktop.computer.version = 4;
    expect(getClassFlowDesktopComputerBridge()).toBeNull();
  });

  it("表面不完整（缺 observe）→ null", () => {
    (window as unknown as { classflowDesktop?: unknown }).classflowDesktop = {
      version: 1,
      platform: "windows",
      filesystem: filesystemStub,
      computer: { version: 1, capabilities: async () => ({}) },
    };
    expect(getClassFlowDesktopComputerBridge()).toBeNull();
  });

  it("Bridge version 非 1 → 整体不可用（既有契约不变）", () => {
    (window as unknown as { classflowDesktop?: unknown }).classflowDesktop = {
      version: 2,
      platform: "windows",
      filesystem: filesystemStub,
      computer: computerStub(),
    };
    expect(getClassFlowDesktopComputerBridge()).toBeNull();
  });

  it("Bridge 缺失时不整体失效：filesystem Bridge 仍可读取", async () => {
    installBridge(true);
    const desktop = getClassFlowDesktopComputerBridge();
    const result = await desktop?.observe({});
    expect(result?.observationId).toBe("obs-test");
  });

  it("Phase 3：v3 完整 session surface → session bridge 可用", () => {
    installBridge(true);
    const computer = (window as unknown as { classflowDesktop: { computer: Record<string, unknown> } }).classflowDesktop
      .computer;
    computer.version = 3;
    for (const method of [
      "listWindows",
      "findElements",
      "activateWindow",
      "openApplication",
      "getSessionStatus",
      "pauseSession",
      "resumeSession",
      "completeSession",
      "setSessionState",
      "subscribeSession",
      "prepareAction",
      "action",
      "cancelActions",
    ]) {
      computer[method] = async () => ({});
    }
    computer.subscribeSession = () => () => {};
    expect(hasClassFlowDesktopComputerSession()).toBe(true);
    expect(getClassFlowDesktopComputerSessionBridge()).not.toBeNull();
    expect(hasClassFlowDesktopComputerAction()).toBe(true);
  });

  it("Phase 3：v2（无 session surface）→ session bridge null，action bridge 仍可用", () => {
    (window as unknown as { classflowDesktop?: unknown }).classflowDesktop = {
      version: 1,
      platform: "windows",
      filesystem: filesystemStub,
      computer: {
        version: 2,
        capabilities: async () => ({}),
        observe: async () => ({}),
        prepareAction: async () => ({}),
        action: async () => ({}),
        cancelActions: async () => ({ ok: true, cancelled: 0 }),
      },
    };
    expect(hasClassFlowDesktopComputerSession()).toBe(false);
    expect(hasClassFlowDesktopComputerAction()).toBe(true);
  });
});
