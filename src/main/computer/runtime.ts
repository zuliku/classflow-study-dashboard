/**
 * Computer Use Phase 1 — Desktop Observation Runtime（Electron Main）。
 *
 * observe_desktop 的 Main 侧唯一入口：
 *   renderer IPC → normalize（strict）→ window registry → screenshot / UIA → Observation Store → 脱敏 Observation
 *
 * 安全契约：
 * - 只读：不实现鼠标 / 键盘 / clipboard / launch app（本文件不存在任何输入 API）
 * - renderer / model 只拿到 opaque windowId / elementId；hwnd / pid / nativeRef 永不外传
 * - 截图只在内存（dataUrl），绝不写入磁盘；Observation 记录短 TTL 后删除
 * - 所有对外字段经过 sanitize（control chars / 长度 bound）
 */
import type {
  ClassFlowDesktopComputerCapabilities,
  ClassFlowDesktopComputerElement,
  ClassFlowDesktopComputerObservation,
  ClassFlowDesktopComputerScreenshotEvidence,
  ClassFlowDesktopComputerWindow,
  ClassFlowDesktopPlatform,
} from "@/lib/desktop/types";
import {
  DesktopObservationStore,
  DesktopComputerIpcError,
  normalizeObserveInput,
} from "./observation";
import {
  DesktopWindowRegistry,
  listNativeWindows,
  type NativeWindowRecord,
} from "./windows";
import { inspectNativeUiTree, probeUiAutomation, type NativeUiElement } from "./uia";

export interface NativeScreenshotEvidence {
  mimeType: "image/jpeg";
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
  capturedAt: string;
}

/** 单次观察返回的窗口列表上限（模型只需可操作目标；不返回全量窗口） */
export const MAX_OBSERVATION_WINDOWS = 20;

export interface DesktopObservationDeps {
  platform: NodeJS.Platform;
  listWindows: () => Promise<NativeWindowRecord[]>;
  captureScreenshot: (input: {
    target: "active-window" | "screen";
    windowTitle?: string | null;
  }) => Promise<NativeScreenshotEvidence | null>;
  inspectUiTree: (hwnd: number) => Promise<{ elements: NativeUiElement[]; truncated: boolean }>;
  probeUiAutomation: () => Promise<boolean>;
  getPrimaryScreenSize: () => { width: number; height: number };
  now: () => number;
}

function platformName(platform: NodeJS.Platform): ClassFlowDesktopPlatform {
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "macos";
  if (platform === "linux") return "linux";
  return "unknown";
}

async function buildDefaultDeps(): Promise<DesktopObservationDeps> {
  // screenshot.ts 依赖 electron（desktopCapturer / screen）→ 动态加载，
  // 保证 runtime / observation 纯逻辑可在无 electron 的测试环境直接导入。
  const screenshotModule = await import("./screenshot");
  return {
    platform: process.platform,
    listWindows: listNativeWindows,
    captureScreenshot: screenshotModule.captureDesktopScreenshot,
    inspectUiTree: inspectNativeUiTree,
    probeUiAutomation: () => probeUiAutomation(),
    getPrimaryScreenSize: screenshotModule.getPrimaryScreenSize,
    now: () => Date.now(),
  };
}

export class DesktopObservationRuntime {
  constructor(
    private readonly deps: DesktopObservationDeps,
    private readonly store: DesktopObservationStore = new DesktopObservationStore(),
    private readonly registry: DesktopWindowRegistry = new DesktopWindowRegistry()
  ) {}

  async capabilities(): Promise<ClassFlowDesktopComputerCapabilities> {
    const platform = platformName(this.deps.platform);
    if (platform !== "windows") {
      return { available: false, platform, screenshot: false, uiAutomation: false };
    }
    let uiAutomation = false;
    try {
      uiAutomation = await this.deps.probeUiAutomation();
    } catch {
      uiAutomation = false;
    }
    return { available: true, platform, screenshot: true, uiAutomation };
  }

  /** observe_desktop → 脱敏 Observation（只读） */
  async observe(rawInput: unknown): Promise<ClassFlowDesktopComputerObservation> {
    const input = normalizeObserveInput(rawInput);
    if (platformName(this.deps.platform) !== "windows") {
      throw new DesktopComputerIpcError("RUNTIME_UNAVAILABLE", "当前平台不支持桌面观察");
    }
    const now = this.deps.now();

    let windows: NativeWindowRecord[];
    try {
      windows = await this.deps.listWindows();
    } catch {
      throw new DesktopComputerIpcError("OBSERVATION_FAILED", "窗口枚举失败");
    }
    this.registry.sync(windows, now);

    let record: NativeWindowRecord | null;
    if (input.windowId) {
      record = this.registry.resolve(input.windowId, now);
      if (!record) throw new DesktopComputerIpcError("NOT_FOUND", "指定的窗口已不存在");
    } else {
      record = windows.find((w) => w.isActive) ?? windows[0] ?? null;
    }

    const warnings: string[] = [];
    const windowTitle = record?.title ?? "";
    const appName = record?.appName ?? "";
    const windowId = record ? this.registry.opaqueIdFor(record.hwnd) : null;

    // 有界窗口列表（opaque windowId；模型可据此选择下一次观察目标）
    const publicWindows: ClassFlowDesktopComputerWindow[] = [];
    for (const window of windows) {
      if (publicWindows.length >= MAX_OBSERVATION_WINDOWS) break;
      const opaqueId = this.registry.opaqueIdFor(window.hwnd);
      if (!opaqueId) continue;
      publicWindows.push({
        windowId: opaqueId,
        title: window.title,
        appName: window.appName,
        active: window.isActive,
      });
    }
    const windowsTruncated = windows.length > publicWindows.length;

    let screenshot: ClassFlowDesktopComputerScreenshotEvidence | null = null;
    if (input.includeScreenshot) {
      try {
        const shot = await this.deps.captureScreenshot({
          target: input.target,
          windowTitle: input.target === "screen" ? null : windowTitle || null,
        });
        if (shot) {
          screenshot = { captured: true, ...shot };
        } else {
          warnings.push("screenshot-unavailable");
        }
      } catch {
        warnings.push("screenshot-unavailable");
      }
    }

    let nativeElements: NativeUiElement[] = [];
    let elementsTruncated = false;
    if (input.includeUiTree) {
      if (record) {
        try {
          const tree = await this.deps.inspectUiTree(record.hwnd);
          nativeElements = tree.elements;
          elementsTruncated = tree.truncated;
        } catch {
          warnings.push("ui-tree-unavailable");
        }
      } else {
        warnings.push("ui-tree-unavailable");
      }
    }

    const elementRefs = new Map<string, string>();
    const elements: ClassFlowDesktopComputerElement[] = nativeElements.map((element, index) => {
      const elementId = `el-${index + 1}`;
      // nativeRef 只留在 runtime memory 的映射里（绝不出现在返回值）
      elementRefs.set(elementId, element.nativeRef);
      return {
        elementId,
        role: element.role,
        name: element.name,
        enabled: element.enabled,
        focused: element.focused,
        bounds: element.bounds,
      };
    });

    const screenSize = (() => {
      try {
        return this.deps.getPrimaryScreenSize();
      } catch {
        return { width: 0, height: 0 };
      }
    })();
    const viewport =
      input.target === "screen" || !record
        ? { width: Math.max(screenSize.width, 0), height: Math.max(screenSize.height, 0) }
        : { width: record.bounds.width, height: record.bounds.height };

    const observation = this.store.create(
      {
        target: input.target,
        windowId,
        windowTitle,
        appName,
        screenshotCapturedAt: screenshot?.capturedAt ?? null,
        elementRefs,
      },
      now
    );

    return {
      observationId: observation.id,
      target: input.target,
      appName,
      windowTitle,
      windowId,
      viewport,
      windows: publicWindows,
      windowsTruncated,
      elements,
      elementCount: elements.length,
      elementsTruncated,
      screenshot,
      warnings,
      uiTreeRevision: observation.revision,
      capturedAt: new Date(now).toISOString(),
    };
  }

  /** 惰性/定时清理过期 observation（含 elementId → native 映射） */
  sweepObservations(now: number = this.deps.now()): number {
    return this.store.sweep(now);
  }

  /** 测试/诊断：当前 store / registry 规模（不含任何 native 标识） */
  stats(): { observations: number; windows: number } {
    return { observations: this.store.size(), windows: this.registry.size() };
  }
}

let singleton: DesktopObservationRuntime | null = null;

/** Main 进程单例（ipc.ts 使用；默认 deps 含 electron 动态加载） */
export async function getDesktopObservationRuntime(): Promise<DesktopObservationRuntime> {
  if (singleton) return singleton;
  singleton = new DesktopObservationRuntime(await buildDefaultDeps());
  return singleton;
}
