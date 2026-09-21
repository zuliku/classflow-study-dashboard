// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  DesktopObservationRuntime,
  type DesktopObservationDeps,
} from "@/src/main/computer/runtime";
import {
  DesktopObservationStore,
  DesktopComputerIpcError,
  normalizeObserveInput,
  DESKTOP_OBSERVATION_TTL_MS,
  DESKTOP_OBSERVATION_MAX_RECORDS,
} from "@/src/main/computer/observation";
import {
  DesktopWindowRegistry,
  parseWindowEnumeration,
  sanitizeWindowTitle,
  type NativeWindowRecord,
} from "@/src/main/computer/windows";
import { parseUiTree } from "@/src/main/computer/uia";

function windowRecord(overrides: Partial<NativeWindowRecord> = {}): NativeWindowRecord {
  return {
    hwnd: 101,
    pid: 4242,
    title: "无标题 - 记事本",
    appName: "notepad",
    bounds: { x: 0, y: 0, width: 1280, height: 720 },
    isActive: true,
    isOffscreen: false,
    zIndex: 0,
    ...overrides,
  };
}

function deps(overrides: Partial<DesktopObservationDeps> = {}): DesktopObservationDeps {
  return {
    platform: "win32",
    listWindows: async () => [windowRecord()],
    captureScreenshot: async () => ({
      mimeType: "image/jpeg" as const,
      dataUrl: "data:image/jpeg;base64,AAAA",
      width: 960,
      height: 540,
      bytes: 1024,
      capturedAt: "2026-09-21T00:00:01.000Z",
    }),
    inspectUiTree: async () => ({
      elements: [
        {
          nativeRef: "42.1001",
          role: "Window",
          name: "无标题 - 记事本",
          enabled: true,
          focused: true,
          bounds: { x: 0, y: 0, width: 1280, height: 720 },
          depth: 0,
        },
        {
          nativeRef: "42.1002",
          role: "Button",
          name: "保存",
          enabled: true,
          focused: false,
          bounds: { x: 10, y: 10, width: 60, height: 24 },
          depth: 1,
        },
      ],
      truncated: false,
    }),
    probeUiAutomation: async () => true,
    getPrimaryScreenSize: () => ({ width: 1920, height: 1080 }),
    now: () => 1_000_000,
    ...overrides,
  };
}

describe("normalizeObserveInput — malformed IPC 输入 fail closed", () => {
  it("空输入 → 默认 active-window + 截图 + UI tree", () => {
    expect(normalizeObserveInput(undefined)).toEqual({
      target: "active-window",
      includeScreenshot: true,
      includeUiTree: true,
    });
  });

  it("合法输入 → 保留", () => {
    expect(
      normalizeObserveInput({
        target: "screen",
        includeScreenshot: false,
        includeUiTree: true,
      })
    ).toEqual({ target: "screen", includeScreenshot: false, includeUiTree: true });
  });

  it("合法 opaque windowId → 保留", () => {
    expect(normalizeObserveInput({ windowId: "win-3f9a2c1b4d5e" })).toEqual({
      target: "active-window",
      windowId: "win-3f9a2c1b4d5e",
      includeScreenshot: true,
      includeUiTree: true,
    });
  });

  it.each([
    ["字符串", "observe"],
    ["数组", []],
    ["未知字段", { hwnd: 1 }],
    ["非法 target", { target: "all" }],
    ["非法 windowId", { windowId: "12345" }],
    ["windowId + screen", { target: "screen", windowId: "win-3f9a2c1b4d5e" }],
    ["非法 boolean", { includeScreenshot: "yes" }],
  ])("%s → INVALID_OPERATION", (_label, input) => {
    try {
      normalizeObserveInput(input);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(DesktopComputerIpcError);
      expect((err as DesktopComputerIpcError).code).toBe("INVALID_OPERATION");
    }
  });
});

describe("DesktopObservationStore — 短生命周期（runtime memory only）", () => {
  it("create 生成 obs-<uuid> 并保存内部映射", () => {
    const store = new DesktopObservationStore();
    const refs = new Map([["el-1", "42.1001"]]);
    const record = store.create(
      {
        target: "active-window",
        windowId: "win-abc123",
        windowTitle: "标题",
        appName: "notepad",
        screenshotCapturedAt: "2026-09-21T00:00:01.000Z",
        elementRefs: refs,
      },
      0
    );
    expect(record.id).toMatch(/^obs-[A-Za-z0-9-]{8,64}$/);
    expect(record.revision).toBe(1);
    expect(store.get(record.id, 0)?.elementRefs.get("el-1")).toBe("42.1001");
  });

  it("TTL 后 get → null 且记录被删除", () => {
    const store = new DesktopObservationStore();
    const record = store.create(
      {
        target: "active-window",
        windowId: null,
        windowTitle: "",
        appName: "",
        screenshotCapturedAt: null,
        elementRefs: new Map(),
      },
      0
    );
    expect(store.get(record.id, DESKTOP_OBSERVATION_TTL_MS)).not.toBeNull();
    expect(store.get(record.id, DESKTOP_OBSERVATION_TTL_MS + 1)).toBeNull();
    expect(store.size()).toBe(0);
  });

  it("sweep 删除全部过期记录", () => {
    const store = new DesktopObservationStore();
    for (let i = 0; i < 3; i++) {
      store.create(
        {
          target: "active-window",
          windowId: null,
          windowTitle: "",
          appName: "",
          screenshotCapturedAt: null,
          elementRefs: new Map(),
        },
        0
      );
    }
    expect(store.sweep(DESKTOP_OBSERVATION_TTL_MS + 10)).toBe(3);
    expect(store.size()).toBe(0);
  });

  it("容量上限淘汰最旧记录", () => {
    const store = new DesktopObservationStore();
    for (let i = 0; i < DESKTOP_OBSERVATION_MAX_RECORDS + 5; i++) {
      store.create(
        {
          target: "active-window",
          windowId: null,
          windowTitle: "",
          appName: "",
          screenshotCapturedAt: null,
          elementRefs: new Map(),
        },
        0
      );
    }
    expect(store.size()).toBe(DESKTOP_OBSERVATION_MAX_RECORDS);
  });
});

describe("DesktopWindowRegistry — opaque windowId 映射", () => {
  it("sync 分配稳定 opaque id；resolve 还原 runtime record", () => {
    const registry = new DesktopWindowRegistry();
    registry.sync([windowRecord()], 0);
    const id = registry.opaqueIdFor(101);
    expect(id).toMatch(/^win-[A-Za-z0-9]{4,32}$/);
    expect(registry.resolve(id!, 0)?.hwnd).toBe(101);
    // 再次 sync 同一窗口 → opaque id 不变
    registry.sync([windowRecord()], 10);
    expect(registry.opaqueIdFor(101)).toBe(id);
  });

  it("未知 id → null；超 TTL → null", () => {
    const registry = new DesktopWindowRegistry();
    registry.sync([windowRecord()], 0);
    const id = registry.opaqueIdFor(101)!;
    expect(registry.resolve("win-deadbeef", 0)).toBeNull();
    expect(registry.resolve(id, 400_000)).toBeNull();
  });
});

describe("窗口 / UI 元素解析 — 脱敏与 bound", () => {
  it("parseWindowEnumeration 过滤空标题与 0 尺寸，控制字符被清洗", () => {
    const parsed = parseWindowEnumeration({
      windows: [
        { hwnd: 1, pid: 2, title: "  Hello\u0000\tWorld  ", appName: "notepad", width: 100, height: 50, x: 1, y: 2 },
        { hwnd: 3, pid: 4, title: "", appName: "x", width: 100, height: 50 },
        { hwnd: 5, pid: 6, title: "Zero", appName: "x", width: 0, height: 50 },
      ],
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe("Hello World");
    expect(parsed[0].hwnd).toBe(1);
  });

  it("sanitizeWindowTitle 超长截断", () => {
    expect(sanitizeWindowTitle("x".repeat(500)).length).toBe(200);
  });

  it("parseUiTree 保留 nativeRef（runtime 内部）并清洗名称", () => {
    const tree = parseUiTree({
      elements: [
        { nativeRef: "42.1", role: "Button", name: " 保存\u0001 ", enabled: true, focused: false, x: 1, y: 2, width: 3, height: 4, depth: 1 },
        { role: "", name: "no role" },
      ],
      truncated: false,
    });
    expect(tree.elements).toHaveLength(1);
    expect(tree.elements[0].nativeRef).toBe("42.1");
    expect(tree.elements[0].name).toBe("保存");
    expect(tree.truncated).toBe(false);
  });
});

describe("DesktopObservationRuntime.observe — 脱敏 Observation", () => {
  it("活动窗口观察：opaque windowId + elements；native 标识只留在 store", async () => {
    const runtime = new DesktopObservationRuntime(deps());
    const observation = await runtime.observe({});
    expect(observation.windowId).toMatch(/^win-[A-Za-z0-9]{4,32}$/);
    expect(observation.appName).toBe("notepad");
    expect(observation.windowTitle).toBe("无标题 - 记事本");
    expect(observation.elementCount).toBe(2);
    expect(observation.elements[0].elementId).toBe("el-1");
    expect(observation.screenshot?.dataUrl).toContain("data:image/jpeg;base64,");

    const serialized = JSON.stringify(observation);
    expect(serialized).not.toMatch(/"hwnd"|"pid"/);
    expect(serialized).not.toContain("nativeRef");
    expect(serialized).not.toContain("42.1001");

    const stats = runtime.stats();
    expect(stats.observations).toBe(1);
    expect(stats.windows).toBe(1);
  });

  it("有界窗口列表：opaque windowId + active 标记；不含 hwnd/pid", async () => {
    const runtime = new DesktopObservationRuntime(
      deps({
        listWindows: async () => [
          windowRecord(),
          windowRecord({ hwnd: 202, pid: 7777, title: "QQ", appName: "QQ", isActive: false, zIndex: 1 }),
        ],
      })
    );
    const observation = await runtime.observe({});
    expect(observation.windows).toHaveLength(2);
    expect(observation.windowsTruncated).toBe(false);
    for (const window of observation.windows) {
      expect(window.windowId).toMatch(/^win-[A-Za-z0-9]{4,32}$/);
    }
    expect(observation.windows[0].active).toBe(true);
    expect(observation.windows[1].title).toBe("QQ");
    const serialized = JSON.stringify(observation.windows);
    expect(serialized).not.toContain("hwnd");
    expect(serialized).not.toContain("pid");
    expect(serialized).not.toMatch(/"202"|"7777"/);
  });

  it("windowId 指定窗口：解析成功；未知 → NOT_FOUND", async () => {
    const runtime = new DesktopObservationRuntime(deps());
    const first = await runtime.observe({});
    const second = await runtime.observe({ windowId: first.windowId! });
    expect(second.windowId).toBe(first.windowId);

    await expect(runtime.observe({ windowId: "win-deadbeef" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("截图失败 → 降级为无截图 + warning；UI tree 失败同理", async () => {
    const runtime = new DesktopObservationRuntime(
      deps({
        captureScreenshot: async () => {
          throw new Error("capture boom");
        },
        inspectUiTree: async () => {
          throw new Error("uia boom");
        },
      })
    );
    const observation = await runtime.observe({});
    expect(observation.screenshot).toBeNull();
    expect(observation.elementCount).toBe(0);
    expect(observation.warnings).toContain("screenshot-unavailable");
    expect(observation.warnings).toContain("ui-tree-unavailable");
    expect(observation.observationId).toMatch(/^obs-/);
  });

  it("includeScreenshot=false / includeUiTree=false → 不采集对应数据", async () => {
    let captured = 0;
    let inspected = 0;
    const runtime = new DesktopObservationRuntime(
      deps({
        captureScreenshot: async () => {
          captured += 1;
          return null;
        },
        inspectUiTree: async () => {
          inspected += 1;
          return { elements: [], truncated: false };
        },
      })
    );
    const observation = await runtime.observe({ includeScreenshot: false, includeUiTree: false });
    expect(captured).toBe(0);
    expect(inspected).toBe(0);
    expect(observation.screenshot).toBeNull();
  });

  it("malformed 输入 → INVALID_OPERATION（在 IO 之前拒绝）", async () => {
    let listed = 0;
    const runtime = new DesktopObservationRuntime(
      deps({
        listWindows: async () => {
          listed += 1;
          return [windowRecord()];
        },
      })
    );
    await expect(runtime.observe({ target: "screen", windowId: "win-abc" })).rejects.toMatchObject({
      code: "INVALID_OPERATION",
    });
    expect(listed).toBe(0);
  });

  it("非 Windows 平台 → RUNTIME_UNAVAILABLE", async () => {
    const runtime = new DesktopObservationRuntime(deps({ platform: "linux" }));
    await expect(runtime.observe({})).rejects.toMatchObject({ code: "RUNTIME_UNAVAILABLE" });
  });

  it("窗口枚举失败 → OBSERVATION_FAILED（不透传 raw error）", async () => {
    const runtime = new DesktopObservationRuntime(
      deps({
        listWindows: async () => {
          throw new Error("powershell boom C:\\secret");
        },
      })
    );
    await expect(runtime.observe({})).rejects.toMatchObject({ code: "OBSERVATION_FAILED" });
  });

  it("capabilities：Windows → available + uiAutomation 探测", async () => {
    const runtime = new DesktopObservationRuntime(deps());
    await expect(runtime.capabilities()).resolves.toEqual({
      available: true,
      platform: "windows",
      screenshot: true,
      uiAutomation: true,
      action: true,
      session: true,
      appControl: true,
    });
  });

  it("capabilities：非 Windows → unavailable", async () => {
    const runtime = new DesktopObservationRuntime(deps({ platform: "darwin" }));
    await expect(runtime.capabilities()).resolves.toEqual({
      available: false,
      platform: "macos",
      screenshot: false,
      uiAutomation: false,
      action: false,
      session: false,
      appControl: false,
    });
  });
});

describe("Phase 1 安全边界 — 源代码不含输入类 API", () => {
  const FORBIDDEN = [
    "sendinputevent",
    "robotjs",
    "mouse_event",
    "keybd_event",
    "sendkeys",
    "clipboard.write",
    "shell.openexternal",
  ];

  function collectSources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return collectSources(full);
      return entry.name.endsWith(".ts") ? [full] : [];
    });
  }

  it("src/main/computer 与 lib/ai/computer/desktop 无鼠标/键盘/clipboard/launch 实现（剪贴板仅限 clipboard.ts）", () => {
    const files = [
      ...collectSources(join(process.cwd(), "src", "main", "computer")),
      ...collectSources(join(process.cwd(), "lib", "ai", "computer", "desktop")),
    ];
    expect(files.length).toBeGreaterThan(0);
    // V2.5：剪贴板读写是唯一例外，且只允许存在于专用模块（默认关闭 + 审批门控）
    const clipboardModule = join(process.cwd(), "src", "main", "computer", "clipboard.ts");
    for (const file of files) {
      const source = readFileSync(file, "utf8").toLowerCase();
      const forbidden = file === clipboardModule ? FORBIDDEN.filter((needle) => needle !== "clipboard.write") : FORBIDDEN;
      for (const needle of forbidden) {
        expect(source, `${file} 不应包含 ${needle}`).not.toContain(needle);
      }
    }
  });

  it("Electron clipboard API 只出现在 clipboard.ts（集中 + 可审计）", () => {
    const files = [
      ...collectSources(join(process.cwd(), "src", "main", "computer")),
      ...collectSources(join(process.cwd(), "lib", "ai", "computer", "desktop")),
    ];
    const clipboardModule = join(process.cwd(), "src", "main", "computer", "clipboard.ts");
    const referencing = files.filter((file) => {
      const source = readFileSync(file, "utf8").toLowerCase();
      return source.includes("clipboard.readtext") || source.includes("clipboard.writetext");
    });
    expect(referencing).toEqual([clipboardModule]);
  });
});
