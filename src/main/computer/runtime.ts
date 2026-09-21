/**
 * Computer Use Phase 1+2 — Desktop Observation & Action Runtime（Electron Main）。
 *
 * observe_desktop / desktop_action 的 Main 侧唯一入口：
 *   renderer IPC → normalize（strict）→ window registry → screenshot / UIA
 *   → Observation Store → 脱敏 Observation
 *   desktop_action → prepareAction（只读校验 + 风险事实）→ action（重新校验 + native 执行）
 *   → settle → 自动重新观察（observe → action → verify observation）
 *
 * 安全契约：
 * - renderer / model 只拿到 opaque windowId / elementId；hwnd / pid / nativeRef 永不外传
 * - 所有输入由 Main / native runtime 执行；renderer 无 unrestricted input API
 * - 观察强绑定：observation 过期 / 窗口切换 / 元素消失 / bounds 明显变化 → STALE_OBSERVATION
 * - blocked（密码 / 密钥 / 提权）在 runtime 再次拦截；敏感文本绝不回传
 * - 截图只在内存（dataUrl），绝不写入磁盘；Observation 短 TTL 后删除
 * - Emergency Stop：cancelActions 清空 session observation 并拒绝后续 action
 */
import type {
  ClassFlowDesktopComputerActionPreparation,
  ClassFlowDesktopComputerActionResult,
  ClassFlowDesktopComputerCapabilities,
  ClassFlowDesktopComputerElement,
  ClassFlowDesktopComputerObservation,
  ClassFlowDesktopComputerScreenshotEvidence,
  ClassFlowDesktopComputerWindow,
  ClassFlowDesktopComputerActionTargetInfo,
  ClassFlowDesktopPlatform,
} from "@/lib/desktop/types";
import {
  DesktopObservationStore,
  DesktopActionSessionRegistry,
  DesktopComputerIpcError,
  computeUiSignature,
  normalizeObserveInput,
  normalizeActionInput,
  type DesktopObservationRecord,
  type NormalizedActionInput,
  type ObservedElementRef,
} from "./observation";
import {
  DesktopWindowRegistry,
  listNativeWindows,
  type NativeWindowRecord,
} from "./windows";
import { inspectNativeUiTree, probeUiAutomation, type NativeUiElement } from "./uia";
import {
  runNativeGuiAction,
  GUI_ACTION_SETTLE_MS,
  type NativeGuiActionConfig,
  type NativeGuiActionResult,
} from "./guiAction";
import { guiKeyToVirtualKeys } from "@/lib/ai/computer/gui/keymap";
import { classifyGuiAction } from "@/lib/ai/computer/gui/risk";

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

/** 元素 bounds 变化阈值（超过 → STALE_OBSERVATION） */
export const OBSERVATION_BOUNDS_POSITION_TOLERANCE = 24;
export const OBSERVATION_BOUNDS_SIZE_TOLERANCE = 32;

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
  /** Phase 2：native 输入执行器（UIA 语义 → bounds → 坐标） */
  runGuiAction: (config: NativeGuiActionConfig) => Promise<NativeGuiActionResult>;
  /** settle 等待（测试可注入 no-op） */
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

function platformName(platform: NodeJS.Platform): ClassFlowDesktopPlatform {
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "macos";
  if (platform === "linux") return "linux";
  return "unknown";
}

async function buildDefaultDeps(): Promise<DesktopObservationDeps> {
  // screenshot.ts / guiAction.ts 依赖 electron 或 native 输入 → 动态加载，
  // 保证 runtime / observation 纯逻辑可在无 electron 的测试环境直接导入。
  const screenshotModule = await import("./screenshot");
  return {
    platform: process.platform,
    listWindows: listNativeWindows,
    captureScreenshot: screenshotModule.captureDesktopScreenshot,
    inspectUiTree: inspectNativeUiTree,
    probeUiAutomation: () => probeUiAutomation(),
    getPrimaryScreenSize: screenshotModule.getPrimaryScreenSize,
    runGuiAction: runNativeGuiAction,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
  };
}

function boundsChanged(
  expected: ObservedElementRef["bounds"],
  current: ObservedElementRef["bounds"]
): boolean {
  return (
    Math.abs(current.x - expected.x) > OBSERVATION_BOUNDS_POSITION_TOLERANCE ||
    Math.abs(current.y - expected.y) > OBSERVATION_BOUNDS_POSITION_TOLERANCE ||
    Math.abs(current.width - expected.width) > OBSERVATION_BOUNDS_SIZE_TOLERANCE ||
    Math.abs(current.height - expected.height) > OBSERVATION_BOUNDS_SIZE_TOLERANCE
  );
}

interface PreparedActionCore {
  preparation: ClassFlowDesktopComputerActionPreparation;
  record: DesktopObservationRecord | null;
  targetInfo: ClassFlowDesktopComputerActionTargetInfo | null;
}

export class DesktopObservationRuntime {
  constructor(
    private readonly deps: DesktopObservationDeps,
    private readonly store: DesktopObservationStore = new DesktopObservationStore(),
    private readonly registry: DesktopWindowRegistry = new DesktopWindowRegistry(),
    private readonly sessions: DesktopActionSessionRegistry = new DesktopActionSessionRegistry()
  ) {}

  async capabilities(): Promise<ClassFlowDesktopComputerCapabilities> {
    const platform = platformName(this.deps.platform);
    if (platform !== "windows") {
      return { available: false, platform, screenshot: false, uiAutomation: false, action: false };
    }
    let uiAutomation = false;
    try {
      uiAutomation = await this.deps.probeUiAutomation();
    } catch {
      uiAutomation = false;
    }
    return { available: true, platform, screenshot: true, uiAutomation, action: true };
  }

  private assertWindowsPlatform(): void {
    if (platformName(this.deps.platform) !== "windows") {
      throw new DesktopComputerIpcError("RUNTIME_UNAVAILABLE", "当前平台不支持桌面运行时");
    }
  }

  private assertSessionActive(sessionId: string | undefined): void {
    if (sessionId && this.sessions.isCancelled(sessionId)) {
      throw new DesktopComputerIpcError("CANCELLED", "用户已停止电脑操作。");
    }
  }

  /** observe_desktop → 脱敏 Observation（只读） */
  async observe(rawInput: unknown): Promise<ClassFlowDesktopComputerObservation> {
    const input = normalizeObserveInput(rawInput);
    this.assertWindowsPlatform();
    this.assertSessionActive(input.sessionId);
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

    const elementRefs = new Map<string, ObservedElementRef>();
    const elements: ClassFlowDesktopComputerElement[] = nativeElements.map((element, index) => {
      const elementId = `el-${index + 1}`;
      // nativeRef 只留在 runtime memory 的映射里（绝不出现在返回值）
      elementRefs.set(elementId, {
        nativeRef: element.nativeRef,
        role: element.role,
        name: element.name,
        isPassword: element.isPassword,
        bounds: { ...element.bounds },
        windowId,
      });
      return {
        elementId,
        role: element.role,
        name: element.name,
        enabled: element.enabled,
        focused: element.focused,
        isPassword: element.isPassword,
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
    // 坐标回退基准：window 观察 = 窗口 bounds；screen 观察 = 主屏
    const coordinateBounds =
      input.target === "screen" || !record
        ? { x: 0, y: 0, width: viewport.width, height: viewport.height }
        : { ...record.bounds };

    const observation = this.store.create(
      {
        target: input.target,
        windowId,
        windowTitle,
        appName,
        screenshotCapturedAt: screenshot?.capturedAt ?? null,
        sessionId: input.sessionId ?? null,
        request: input,
        coordinateBounds,
        uiSignature: computeUiSignature(elements),
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

  /** 只读校验 + 风险事实（不执行任何输入） */
  async prepareAction(rawInput: unknown): Promise<ClassFlowDesktopComputerActionPreparation> {
    const core = await this.prepareActionCore(rawInput);
    return core.preparation;
  }

  /** prepareAction 完整链路（action 复用，避免重复校验两次） */
  private async prepareActionCore(rawInput: unknown): Promise<PreparedActionCore> {
    const input = normalizeActionInput(rawInput);
    this.assertWindowsPlatform();
    this.assertSessionActive(input.sessionId);

    if (input.action === "wait") {
      return {
        preparation: {
          action: "wait",
          risk: { level: "normal", reason: "等待（无输入）" },
          target: { kind: "none", appName: "", windowTitle: "", windowId: null, targetLabel: "等待" },
          observationId: null,
          textPreview: null,
          requiresObservation: false,
        },
        record: null,
        targetInfo: null,
      };
    }

    const record = await this.resolveBoundObservation(input);
    const targetInfo = await this.resolveActionTarget(input, record);
    const risk = classifyGuiAction({
      action: input.action,
      ...(input.text !== undefined ? { text: input.text } : {}),
      ...(input.key !== undefined ? { key: input.key } : {}),
      target: {
        kind: targetInfo.kind,
        ...(targetInfo.role !== undefined ? { role: targetInfo.role } : {}),
        ...(targetInfo.name !== undefined ? { name: targetInfo.name } : {}),
        isPassword: targetInfo.isPassword === true,
        appName: targetInfo.appName,
        windowTitle: targetInfo.windowTitle,
      },
    });

    return {
      preparation: {
        action: input.action,
        risk: { level: risk.level, reason: risk.reason },
        target: targetInfo,
        observationId: record.id,
        textPreview: risk.textPreview,
        requiresObservation: true,
      },
      record,
      targetInfo,
    };
  }

  /** 执行 GUI 动作：重新完整校验 → native 执行 → settle → 自动重新观察 */
  async action(rawInput: unknown): Promise<ClassFlowDesktopComputerActionResult> {
    const input = normalizeActionInput(rawInput);
    this.assertWindowsPlatform();
    this.assertSessionActive(input.sessionId);

    if (input.action === "wait") {
      const duration = Math.min(Math.max(input.wait ?? 500, 100), 5000);
      const started = this.deps.now();
      await this.deps.sleep(duration);
      return {
        actionResult: { action: "wait", method: "wait", durationMs: this.deps.now() - started },
        observation: null,
        newObservationId: null,
        changedWindow: null,
        uiChanged: null,
      };
    }

    const core = await this.prepareActionCore(rawInput);
    const { preparation, record } = core;
    if (!record) {
      throw new DesktopComputerIpcError("STALE_OBSERVATION", "观察已失效，请重新 observe_desktop。");
    }
    if (preparation.risk.level === "blocked") {
      throw new DesktopComputerIpcError("ACTION_BLOCKED", preparation.risk.reason);
    }

    const vk = input.key !== undefined ? guiKeyToVirtualKeys(input.key) : null;
    if (input.action === "key" && (!vk || vk.length === 0)) {
      throw new DesktopComputerIpcError("ACTION_BLOCKED", "按键不在允许列表内。");
    }

    const elementRef =
      input.target?.elementId !== undefined
        ? record.elementRefs.get(input.target.elementId) ?? null
        : null;
    const point =
      input.target?.normalized !== undefined
        ? this.normalizedToPoint(input.target.normalized, record)
        : undefined;

    const config: NativeGuiActionConfig = {
      hwnd: this.requireWindowHwnd(record),
      nativeRef: elementRef?.nativeRef ?? null,
      ...(elementRef ? { expectedBounds: elementRef.bounds } : {}),
      action: input.action,
      ...(input.text !== undefined ? { text: input.text } : {}),
      ...(vk ? { vk } : {}),
      ...(input.scroll !== undefined ? { scroll: input.scroll } : {}),
      ...(point ? { point } : {}),
    };

    // 最后一道 session 检查（审批 / 校验期间用户可能已 Stop）
    this.assertSessionActive(input.sessionId);

    const started = this.deps.now();
    const result = await this.deps.runGuiAction(config);
    if (!result.ok) {
      const reason = result.reason ?? "action-failed";
      if (
        reason === "element-missing" ||
        reason === "bounds-changed" ||
        reason === "window-not-foreground"
      ) {
        throw new DesktopComputerIpcError(
          "STALE_OBSERVATION",
          "界面已变化，请重新 observe_desktop 后再操作。"
        );
      }
      if (reason === "element-disabled" || reason === "password-field") {
        throw new DesktopComputerIpcError("ACTION_BLOCKED", `操作被拒绝：${reason}`);
      }
      throw new DesktopComputerIpcError("ACTION_FAILED", "GUI 操作执行失败。");
    }

    // 执行后再次确认 session 仍有效（Stop 后结果不得继续回流）
    this.assertSessionActive(input.sessionId);

    await this.deps.sleep(GUI_ACTION_SETTLE_MS);
    const nextObservation = await this.observe({
      ...record.request,
      ...(record.sessionId ? { sessionId: record.sessionId } : {}),
    });
    const nextRecord = this.store.get(nextObservation.observationId, this.deps.now());

    return {
      actionResult: {
        action: input.action,
        method: (result.method ??
          "action") as ClassFlowDesktopComputerActionResult["actionResult"]["method"],
        durationMs: this.deps.now() - started,
      },
      observation: nextObservation,
      newObservationId: nextObservation.observationId,
      changedWindow:
        nextObservation.windowId !== record.windowId || nextObservation.appName !== record.appName,
      uiChanged: nextRecord ? nextRecord.uiSignature !== record.uiSignature : null,
    };
  }

  /** Emergency Stop：标记 session cancelled + 清空该 session observation */
  cancelActions(rawInput: unknown): { ok: boolean; cancelled: number } {
    if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
      throw new DesktopComputerIpcError("INVALID_OPERATION", "cancel 输入必须是对象");
    }
    const raw = rawInput as Record<string, unknown>;
    for (const key of Object.keys(raw)) {
      if (key !== "sessionId") {
        throw new DesktopComputerIpcError("INVALID_OPERATION", `不支持的字段：${key}`);
      }
    }
    if (typeof raw.sessionId !== "string" || !/^cs-[A-Za-z0-9-]{8,64}$/.test(raw.sessionId)) {
      throw new DesktopComputerIpcError("INVALID_OPERATION", "sessionId 不合法");
    }
    this.sessions.markCancelled(raw.sessionId);
    const cancelled = this.store.cancelSession(raw.sessionId);
    return { ok: true, cancelled };
  }

  /** 校验 observation 强绑定（过期 / session / 窗口一致） */
  private async resolveBoundObservation(input: NormalizedActionInput): Promise<DesktopObservationRecord> {
    const record = this.store.get(input.observationId ?? "", this.deps.now());
    if (!record) {
      throw new DesktopComputerIpcError("STALE_OBSERVATION", "观察已过期，请重新 observe_desktop。");
    }
    if (input.sessionId && record.sessionId && input.sessionId !== record.sessionId) {
      throw new DesktopComputerIpcError("STALE_OBSERVATION", "观察属于其它会话，请重新 observe_desktop。");
    }
    if (!record.windowId) {
      throw new DesktopComputerIpcError(
        "STALE_OBSERVATION",
        "该观察没有可操作窗口，请重新 observe_desktop（active-window）。"
      );
    }
    const now = this.deps.now();
    let windows: NativeWindowRecord[];
    try {
      windows = await this.deps.listWindows();
    } catch {
      throw new DesktopComputerIpcError("OBSERVATION_FAILED", "窗口枚举失败");
    }
    this.registry.sync(windows, now);
    const observedWindow = this.registry.resolve(record.windowId, now);
    if (!observedWindow) {
      throw new DesktopComputerIpcError("STALE_OBSERVATION", "观察对应的窗口已不存在。");
    }
    const active = windows.find((w) => w.isActive);
    if (!active || active.hwnd !== observedWindow.hwnd) {
      throw new DesktopComputerIpcError("STALE_OBSERVATION", "当前活动窗口已切换，请重新 observe_desktop。");
    }
    return record;
  }

  /** 解析动作目标（元素重新检查存在性 / bounds）或坐标 */
  private async resolveActionTarget(
    input: NormalizedActionInput,
    record: DesktopObservationRecord
  ): Promise<ClassFlowDesktopComputerActionTargetInfo> {
    const window = this.registry.resolve(record.windowId ?? "", this.deps.now());
    const windowTitle = window?.title ?? record.windowTitle;
    const appName = window?.appName ?? record.appName;
    const windowId = record.windowId;

    if (input.target?.elementId !== undefined) {
      const stored = record.elementRefs.get(input.target.elementId);
      if (!stored) {
        throw new DesktopComputerIpcError("STALE_OBSERVATION", "目标元素已不存在，请重新 observe_desktop。");
      }
      let current: NativeUiElement | null = null;
      try {
        const tree = await this.deps.inspectUiTree(window?.hwnd ?? 0);
        current = tree.elements.find((element) => element.nativeRef === stored.nativeRef) ?? null;
      } catch {
        throw new DesktopComputerIpcError("OBSERVATION_FAILED", "界面读取失败，请重新 observe_desktop。");
      }
      if (!current) {
        throw new DesktopComputerIpcError("STALE_OBSERVATION", "目标元素已消失，请重新 observe_desktop。");
      }
      if (boundsChanged(stored.bounds, current.bounds)) {
        throw new DesktopComputerIpcError("STALE_OBSERVATION", "目标元素位置已变化，请重新 observe_desktop。");
      }
      return {
        kind: "element",
        elementId: input.target.elementId,
        role: current.role,
        name: current.name,
        isPassword: current.isPassword,
        appName,
        windowTitle,
        windowId,
        targetLabel: `${current.role}${current.name ? `「${current.name.slice(0, 48)}」` : ""}`,
      };
    }

    if (input.target?.normalized !== undefined) {
      return {
        kind: "coordinates",
        appName,
        windowTitle,
        windowId,
        targetLabel: `坐标 (${input.target.normalized.x.toFixed(2)}, ${input.target.normalized.y.toFixed(2)})`,
      };
    }

    return {
      kind: "none",
      appName,
      windowTitle,
      windowId,
      targetLabel: input.action === "type" ? "当前焦点输入" : "当前焦点按键",
    };
  }

  /** 观察时的窗口 HWND（仅 runtime 内部） */
  private requireWindowHwnd(record: DesktopObservationRecord): number {
    const window = record.windowId
      ? this.registry.resolve(record.windowId, this.deps.now())
      : null;
    if (!window) {
      throw new DesktopComputerIpcError("STALE_OBSERVATION", "观察对应的窗口已不存在。");
    }
    return window.hwnd;
  }

  /** normalized (0~1) → 绝对像素（observation 的 coordinateBounds 基准） */
  private normalizedToPoint(
    normalized: { x: number; y: number },
    record: DesktopObservationRecord
  ): { x: number; y: number } {
    const bounds = record.coordinateBounds ?? { x: 0, y: 0, width: 0, height: 0 };
    return {
      x: Math.round(bounds.x + normalized.x * bounds.width),
      y: Math.round(bounds.y + normalized.y * bounds.height),
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
