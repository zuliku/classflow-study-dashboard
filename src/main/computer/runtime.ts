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
  ClassFlowDesktopComputerAppLaunchResult,
  ClassFlowDesktopComputerCapabilities,
  ClassFlowDesktopComputerElement,
  ClassFlowDesktopComputerElementSearchResult,
  ClassFlowDesktopComputerObservation,
  ClassFlowDesktopComputerScreenshotEvidence,
  ClassFlowDesktopComputerSessionEvent,
  ClassFlowDesktopComputerSessionStatus,
  ClassFlowDesktopComputerWindow,
  ClassFlowDesktopComputerWindowList,
  ClassFlowDesktopComputerActionTargetInfo,
  ClassFlowDesktopPlatform,
} from "@/lib/desktop/types";
import {
  DesktopObservationStore,
  DesktopComputerIpcError,
  computeUiSignature,
  normalizeActionInput,
  normalizeActivateWindowInput,
  normalizeFindElementsInput,
  normalizeObserveInput,
  normalizeOpenApplicationInput,
  normalizeOptionalSessionInput,
  normalizeSessionOnlyInput,
  normalizeSessionPlanInput,
  normalizeSessionStateInput,
  type DesktopObservationRecord,
  type NormalizedActionInput,
  type NormalizedActionTarget,
  type ObservedElementRef,
} from "./observation";
import { searchObservationElements } from "@/lib/ai/computer/desktop/elementSearch";
import {
  evaluateActionExpectation,
  hasVerifiableExpectation,
  type VerificationResult,
} from "./verify";
import {
  DesktopWindowRegistry,
  activateNativeWindow,
  listNativeWindows,
  type NativeWindowRecord,
} from "./windows";
import {
  DesktopControlSessionStore,
  DesktopSessionGuardError,
  DESKTOP_SESSION_LIMITS,
} from "./session";
import {
  DESKTOP_APP_ALLOWLIST,
  desktopAppLabel,
  launchResolvedDesktopApp,
  normalizeDesktopAppId,
  resolveDesktopApp,
  type ResolvedDesktopApp,
} from "./apps";
import { inspectNativeUiTree, probeUiAutomation, type NativeUiElement } from "./uia";
import {
  desktopAppProfileInfo,
  desktopAppProfileRiskHint,
  desktopAppReadyWaitMs,
  desktopAppSettleMs,
  resolveDesktopAppProfile,
} from "./appProfiles";
import {
  runNativeGuiAction,
  GUI_ACTION_SETTLE_MS,
  type NativeGuiActionConfig,
  type NativeGuiActionResult,
  type NativeGuiActionType,
} from "./guiAction";
import { guiKeyToVirtualKeys } from "@/lib/ai/computer/gui/keymap";
import { classifyGuiAction } from "@/lib/ai/computer/gui/risk";
import { isSystemFileDialog } from "./upload";
import {
  MIN_TRAJECTORY_STEPS_FOR_SKILL,
  buildDesktopSkillDraft,
} from "./trajectory";
import type { SkillDraft } from "@/lib/ai/skills/types";

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

/** V2.1 自适应 settle：expect 存在时轮询直到验证通过或超时 */
export const ADAPTIVE_SETTLE_FIRST_MS = 150;
export const ADAPTIVE_SETTLE_POLL_MS = 300;
export const ADAPTIVE_SETTLE_TIMEOUT_MS = 1500;

export interface DesktopObservationDeps {
  platform: NodeJS.Platform;
  listWindows: () => Promise<NativeWindowRecord[]>;
  captureScreenshot: (input: {
    target: "active-window" | "screen";
    windowTitle?: string | null;
  }) => Promise<NativeScreenshotEvidence | null>;
  inspectUiTree: (hwnd: number) => Promise<{ elements: NativeUiElement[]; truncated: boolean }>;
  /**
   * V2.2：单元素解析（worker 缓存命中；不传则回退全树扫描）。
   * 返回 null = 元素不存在；抛错 = UIA 读取失败。
   */
  resolveUiElement?: (hwnd: number, nativeRef: string) => Promise<NativeUiElement | null>;
  probeUiAutomation: () => Promise<boolean>;
  getPrimaryScreenSize: () => { width: number; height: number };
  /** Phase 2：native 输入执行器（UIA 语义 → bounds → 坐标） */
  runGuiAction: (config: NativeGuiActionConfig) => Promise<NativeGuiActionResult>;
  /** Phase 3：窗口激活 / 应用解析与启动 */
  activateWindow: (hwnd: number) => Promise<boolean>;
  resolveApp: (appId: string) => Promise<ResolvedDesktopApp>;
  launchApp: (resolved: ResolvedDesktopApp) => boolean;
  /**
   * V2.5：剪贴板读写（默认实现走 Electron clipboard；缺失 → 动作失败）。
   * 只在用户显式开启 + allow-once 审批后到达这里。
   */
  readClipboard?: () => string;
  writeClipboard?: (text: string) => boolean;
  /**
   * V2.5：upload_file 的 grantId + 相对路径 → 绝对路径（Main 侧授权校验；无效 → null）。
   * 绝对路径绝不回传 renderer / model。
   */
  resolveUploadPath?: (grantId: string, relativePath: string) => string | null;
  /** V2.5：文件选择对话框识别（纯函数；缺失 → 用内置实现） */
  isFileDialog?: (input: { appName?: string | null; windowTitle?: string | null; elementNames?: string[] }) => boolean;
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
  // screenshot.ts 依赖 electron（desktopCapturer / screen）→ 动态加载，
  // 保证 runtime / observation 纯逻辑可在无 electron 的测试环境直接导入。
  const screenshotModule = await import("./screenshot");
  // V2.2：UIA 走常驻 worker（缓存 + 无冷启动）；worker 不可用时各方法内部回退一次性脚本。
  const workerClient = await import("./uiaWorkerClient");
  // V2.5：剪贴板（Electron）与上传路径解析（授权 grant）→ 动态加载，保持可测试。
  const clipboardModule = await import("./clipboard");
  const uploadModule = await import("./upload");
  const desktopBridgeModule = await import("../desktopBridge");
  return {
    platform: process.platform,
    listWindows: workerClient.workerListNativeWindows,
    captureScreenshot: screenshotModule.captureDesktopScreenshot,
    inspectUiTree: workerClient.workerInspectNativeUiTree,
    resolveUiElement: workerClient.workerResolveNativeUiElement,
    probeUiAutomation: () => probeUiAutomation(),
    getPrimaryScreenSize: screenshotModule.getPrimaryScreenSize,
    runGuiAction: workerClient.workerRunNativeGuiAction,
    activateWindow: workerClient.workerActivateNativeWindow,
    resolveApp: resolveDesktopApp,
    launchApp: launchResolvedDesktopApp,
    readClipboard: clipboardModule.readClipboardText,
    writeClipboard: clipboardModule.writeClipboardText,
    resolveUploadPath: desktopBridgeModule.resolveComputerUploadPath,
    isFileDialog: uploadModule.isSystemFileDialog,
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
    private readonly sessions: DesktopControlSessionStore = new DesktopControlSessionStore()
  ) {}

  /** renderer 事件推送入口（ipc.ts 注册；事件已脱敏） */
  setSessionEventSink(sink: ((event: ClassFlowDesktopComputerSessionEvent) => void) | null): void {
    this.sessions.setEmitter(sink);
  }

  async capabilities(): Promise<ClassFlowDesktopComputerCapabilities> {
    const platform = platformName(this.deps.platform);
    if (platform !== "windows") {
      return {
        available: false,
        platform,
        screenshot: false,
        uiAutomation: false,
        action: false,
        session: false,
        appControl: false,
      };
    }
    let uiAutomation = false;
    try {
      uiAutomation = await this.deps.probeUiAutomation();
    } catch {
      uiAutomation = false;
    }
    return {
      available: true,
      platform,
      screenshot: true,
      uiAutomation,
      action: true,
      session: true,
      appControl: true,
    };
  }

  private assertWindowsPlatform(): void {
    if (platformName(this.deps.platform) !== "windows") {
      throw new DesktopComputerIpcError("RUNTIME_UNAVAILABLE", "当前平台不支持桌面运行时");
    }
  }

  /** Session Guard 错误 → Bridge 结构化错误 */
  private mapSessionGuardError(err: unknown): DesktopComputerIpcError {
    if (err instanceof DesktopSessionGuardError) {
      const code =
        err.code === "SESSION_CANCELLED"
          ? "CANCELLED"
          : err.code === "SESSION_PAUSED"
            ? "SESSION_PAUSED"
            : err.code === "SESSION_LIMIT_REACHED"
              ? "SESSION_LIMIT_REACHED"
              : err.code === "REPEATED_ACTION"
                ? "REPEATED_ACTION"
                : "NO_PROGRESS";
      return new DesktopComputerIpcError(code, err.message);
    }
    return err instanceof DesktopComputerIpcError
      ? err
      : new DesktopComputerIpcError("ACTION_FAILED", "电脑操作失败。");
  }

  /** observe_desktop → 脱敏 Observation（只读） */
  async observe(rawInput: unknown): Promise<ClassFlowDesktopComputerObservation> {
    const input = normalizeObserveInput(rawInput);
    this.assertWindowsPlatform();
    const now = this.deps.now();
    // Phase 3：Session 生命周期 + 观察次数守卫
    if (input.sessionId) {
      try {
        this.sessions.beginObserve(input.sessionId, now);
      } catch (err) {
        throw this.mapSessionGuardError(err);
      }
    }

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
    // V2.4：应用画像（进程名 → 标题模式；blocked 应用只读可见、动作永不放行）
    const appProfile = resolveDesktopAppProfile({ appName, windowTitle });
    const appProfileInfo = desktopAppProfileInfo(appProfile);
    if (appProfile?.blocked) warnings.push("app-profile-blocked");
    const windowId = record ? this.registry.opaqueIdFor(record.hwnd) : null;
    const focusedWindow = windows.find((window) => window.isActive);
    const focusedWindowId = focusedWindow ? this.registry.opaqueIdFor(focusedWindow.hwnd) : null;
    const activeApplication = focusedWindow?.appName ?? appName;

    // 有界窗口列表（opaque windowId + z-order；模型可据此选择下一次观察目标）
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
        zOrder: window.zIndex,
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
        enabled: element.enabled,
        focused: element.focused,
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

    // Session：记录 UI 指纹 / 当前应用（no-progress 检测依据）
    if (input.sessionId) {
      this.sessions.endObserve(
        input.sessionId,
        {
          appName,
          windowTitle,
          uiSignature: observation.uiSignature,
          appProfile: appProfileInfo,
        },
        now
      );
    }

    return {
      observationId: observation.id,
      target: input.target,
      appName,
      windowTitle,
      windowId,
      activeApplication,
      focusedWindow: focusedWindowId,
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
      appProfile: appProfileInfo,
      ...(input.sessionId
        ? { session: this.sessions.get(input.sessionId, now) ?? undefined }
        : {}),
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
    this.assertSessionUsable(input.sessionId);

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

    // V2.5：剪贴板动作无 GUI 目标（风险由「用户显式开启」事实决定）
    if (input.action === "clipboard_read" || input.action === "clipboard_write") {
      const clipboardRisk = classifyGuiAction({
        action: input.action,
        target: { kind: "none", appName: "", windowTitle: "" },
        clipboardAllowed: input.clipboardAllowed === true,
      });
      return {
        preparation: {
          action: input.action,
          risk: { level: clipboardRisk.level, reason: clipboardRisk.reason },
          target: {
            kind: "none",
            appName: "",
            windowTitle: "",
            windowId: null,
            targetLabel: input.action === "clipboard_read" ? "剪贴板（读取）" : "剪贴板（覆盖写入）",
          },
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
    // V2.4：应用画像参与风险分类（blocked 应用 / 应用内高风险控件）
    const profile = resolveDesktopAppProfile({
      appName: targetInfo.appName,
      windowTitle: targetInfo.windowTitle,
    });
    const profileHint = desktopAppProfileRiskHint(profile);
    // V2.5：upload_file 必须落在系统文件选择对话框（标题 + 控件双重事实）
    const fileDialog =
      input.action === "upload_file"
        ? this.isFileDialog({
            appName: targetInfo.appName,
            windowTitle: targetInfo.windowTitle,
            elementNames: Array.from(record.elementRefs.values()).map((ref) => ref.name),
          })
        : undefined;
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
      ...(profileHint ? { profile: profileHint } : {}),
      ...(fileDialog !== undefined ? { fileDialog } : {}),
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

    if (input.action === "wait") {
      const duration = Math.min(Math.max(input.wait ?? 500, 100), 5000);
      const started = this.deps.now();
      if (input.sessionId) {
        try {
          this.sessions.beginAction(
            input.sessionId,
            { fingerprint: "wait", actionLabel: "等待", appName: null, windowTitle: null },
            started
          );
        } catch (err) {
          throw this.mapSessionGuardError(err);
        }
      }
      await this.deps.sleep(duration);
      if (input.sessionId) {
        this.sessions.endAction(input.sessionId, { beforeUiSignature: null, newUiSignature: null, ok: true, actionFingerprint: "wait" }, this.deps.now());
      }
      return {
        actionResult: { action: "wait", method: "wait", durationMs: this.deps.now() - started },
        observation: null,
        newObservationId: null,
        changedWindow: null,
        uiChanged: null,
      };
    }

    // Phase 3：Session action 守卫（计数 / repeated-action / 时长）
    const fingerprint = this.actionFingerprint(input);
    if (input.sessionId) {
      try {
        this.sessions.beginAction(
          input.sessionId,
          {
            fingerprint,
            actionLabel: `${input.action}${input.target?.elementId ? ` ${input.target.elementId}` : ""}`,
            appName: null,
            windowTitle: null,
          },
          this.deps.now()
        );
      } catch (err) {
        throw this.mapSessionGuardError(err);
      }
    }

    // V2.5：剪贴板动作（无 observation / 无 GUI 脚本；风险由「显式开启」事实决定）
    if (input.action === "clipboard_read" || input.action === "clipboard_write") {
      return this.runClipboardAction(input, fingerprint);
    }


    const core = await this.prepareActionCore(rawInput);
    const { preparation, record } = core;
    if (!record) {
      throw new DesktopComputerIpcError("STALE_OBSERVATION", "观察已失效，请重新 observe_desktop。");
    }
    if (preparation.risk.level === "blocked") {
      if (input.sessionId) this.sessions.endAction(input.sessionId, { beforeUiSignature: null, newUiSignature: null, ok: false, actionFingerprint: fingerprint }, this.deps.now());
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
    // V2.5：drag 落点（同一 observation 内的元素 / 归一化坐标）
    const toPoint = input.to !== undefined ? this.resolvePointForTarget(input.to, record) : undefined;
    if (input.action === "drag") {
      const fromPoint = elementRef ? this.elementCenter(elementRef.bounds) : point;
      if (!fromPoint || !toPoint) {
        throw new DesktopComputerIpcError("INVALID_OPERATION", "拖拽需要明确的起点与落点。");
      }
      const windowBounds = this.windowBoundsFor(record);
      if (!this.isInsideBounds(fromPoint, windowBounds) || !this.isInsideBounds(toPoint, windowBounds)) {
        throw new DesktopComputerIpcError(
          "INVALID_OPERATION",
          "拖拽起点与落点都必须在目标窗口内（禁止拖到窗口外）。"
        );
      }
    }

    const config: NativeGuiActionConfig = {
      hwnd: this.requireWindowHwnd(record),
      nativeRef: elementRef?.nativeRef ?? null,
      ...(elementRef ? { expectedBounds: elementRef.bounds } : {}),
      action: input.action as NativeGuiActionType,
      ...(input.text !== undefined ? { text: input.text } : {}),
      ...(vk ? { vk } : {}),
      ...(input.scroll !== undefined ? { scroll: input.scroll } : {}),
      ...(input.axis !== undefined ? { axis: input.axis } : {}),
      ...(point ? { point } : {}),
      ...(toPoint ? { toPoint } : {}),
    };

    // 最后一道 session 检查（审批 / 校验期间用户可能已 Stop / Pause）
    this.assertSessionUsable(input.sessionId);

    const started = this.deps.now();
    const result =
      input.action === "upload_file"
        ? await this.runUploadAction(input, record, elementRef)
        : await this.deps.runGuiAction(config);
    if (!result.ok) {
      const reason = result.reason ?? "action-failed";
      if (input.sessionId) {
        this.sessions.endAction(input.sessionId, { beforeUiSignature: null, newUiSignature: null, ok: false, actionFingerprint: fingerprint }, this.deps.now());
      }
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
      if (reason === "file-not-authorized" || reason === "missing-file") {
        throw new DesktopComputerIpcError(
          "ACTION_BLOCKED",
          "文件不在已授权的工作区文件夹内（仅支持本机工作区文件）。"
        );
      }
      if (reason === "not-file-dialog") {
        throw new DesktopComputerIpcError(
          "ACTION_BLOCKED",
          "文件上传仅支持系统文件选择对话框（请先打开「打开 / 另存为」对话框）。"
        );
      }
      if (reason === "outside-window") {
        throw new DesktopComputerIpcError("INVALID_OPERATION", "拖拽起点与落点必须在目标窗口内。");
      }
      throw new DesktopComputerIpcError("ACTION_FAILED", "GUI 操作执行失败。");
    }

    // 执行后再次确认 session 仍有效（Stop 后结果不得继续回流）
    this.assertSessionUsable(input.sessionId);

    // V2.1：expect → 自适应 settle（轮询直到验证通过或超时）；无 expect → 固定 settle
    const expectation = input.expect;
    const expectConfigured = hasVerifiableExpectation(expectation);
    const disappearedNativeRef =
      expectation?.elementDisappears?.elementId !== undefined
        ? record.elementRefs.get(expectation.elementDisappears.elementId)?.nativeRef ?? null
        : null;

    const observeOnce = async () => {
      const observation = await this.observe({
        ...record.request,
        ...(record.sessionId ? { sessionId: record.sessionId } : {}),
      });
      return { observation, record: this.store.get(observation.observationId, this.deps.now()) };
    };

    let nextObservation: ClassFlowDesktopComputerObservation;
    let nextRecord: DesktopObservationRecord | null;
    let verification: VerificationResult | undefined;

    if (expectConfigured && expectation) {
      const deadline = started + ADAPTIVE_SETTLE_TIMEOUT_MS;
      await this.deps.sleep(ADAPTIVE_SETTLE_FIRST_MS);
      ({ observation: nextObservation, record: nextRecord } = await observeOnce());
      verification = this.evaluateExpectation(expectation, nextObservation, nextRecord, disappearedNativeRef);
      while (!verification.passed && this.deps.now() < deadline) {
        this.assertSessionUsable(input.sessionId);
        await this.deps.sleep(ADAPTIVE_SETTLE_POLL_MS);
        ({ observation: nextObservation, record: nextRecord } = await observeOnce());
        verification = this.evaluateExpectation(expectation, nextObservation, nextRecord, disappearedNativeRef);
      }
    } else {
      // V2.4：按应用画像 settle（未知应用 → GUI_ACTION_SETTLE_MS 默认值）
      const settleProfile = resolveDesktopAppProfile({
        appName: record.appName,
        windowTitle: record.windowTitle,
      });
      await this.deps.sleep(desktopAppSettleMs(settleProfile));
      ({ observation: nextObservation, record: nextRecord } = await observeOnce());
    }

    // Session 后置结算：no-progress 检测（UI 指纹不变 + 动作相似）
    if (input.sessionId) {
      try {
        this.sessions.endAction(
          input.sessionId,
          {
            beforeUiSignature: record.uiSignature,
            newUiSignature: nextRecord?.uiSignature ?? null,
            ok: true,
            actionFingerprint: fingerprint,
          },
          this.deps.now()
        );
      } catch (err) {
        throw this.mapSessionGuardError(err);
      }
      // V2.3：expect 验证结果参与反思判定（连续失败 → reflectionRequired）
      this.sessions.recordVerification(
        input.sessionId,
        verification ? verification.passed : null,
        this.deps.now()
      );
      // V2.6：记录结构化轨迹（无输入文本 / 路径 / 截图）
      this.sessions.recordTrajectoryStep(
        input.sessionId,
        {
          action: input.action,
          targetLabel: preparation.target.targetLabel,
          risk: preparation.risk.level,
          verificationPassed: verification ? verification.passed : null,
        },
        this.deps.now()
      );
    }

    // V2.3：反思提示（模型必须重新观察 / 更新计划，而不是重复同一动作）
    const reflection = input.sessionId ? this.sessions.reflectionSnapshot(input.sessionId) : null;
    const reflectionRequired = reflection?.required === true;

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
      ...(verification ? { verification } : {}),
      ...(reflectionRequired
        ? {
            reflectionRequired: true,
            reflectionHint:
              "上一步未达到预期或界面无变化：请重新 observe_desktop（必要时用 find_desktop_element 重新定位），" +
              "并用 desktop_session 更新计划后再继续；不要重复同一动作。",
          }
        : {}),
      ...(input.sessionId
        ? { session: this.sessions.get(input.sessionId, this.deps.now()) ?? undefined }
        : {}),
    };
  }

  /** V2.5：剪贴板动作（默认关闭；显式开启后仍需 allow-once 审批） */
  private async runClipboardAction(
    input: NormalizedActionInput,
    fingerprint: string
  ): Promise<ClassFlowDesktopComputerActionResult> {
    const started = this.deps.now();
    const fail = (code: "ACTION_BLOCKED" | "ACTION_FAILED", message: string): never => {
      if (input.sessionId) {
        this.sessions.endAction(
          input.sessionId,
          { beforeUiSignature: null, newUiSignature: null, ok: false, actionFingerprint: fingerprint },
          this.deps.now()
        );
      }
      throw new DesktopComputerIpcError(code, message);
    };

    if (input.clipboardAllowed !== true) {
      fail("ACTION_BLOCKED", "用户尚未开启剪贴板访问（设置 → Kiro → 允许剪贴板读写）。");
    }

    if (input.action === "clipboard_write") {
      const text = input.clipboardText ?? "";
      if (!text) fail("ACTION_FAILED", "剪贴板写入内容为空。");
      const write = this.deps.writeClipboard;
      if (!write || write(text) !== true) {
        fail("ACTION_FAILED", "剪贴板写入失败。");
      }
    }

    const clipboardText =
      input.action === "clipboard_read" ? this.deps.readClipboard?.() ?? "" : undefined;

    if (input.sessionId) {
      this.sessions.endAction(
        input.sessionId,
        { beforeUiSignature: null, newUiSignature: null, ok: true, actionFingerprint: fingerprint },
        this.deps.now()
      );
      // V2.6：剪贴板动作同样进入轨迹（不含剪贴板内容）
      this.sessions.recordTrajectoryStep(
        input.sessionId,
        {
          action: input.action,
          targetLabel: input.action === "clipboard_read" ? "剪贴板（读取）" : "剪贴板（覆盖写入）",
          risk: "sensitive",
          verificationPassed: null,
        },
        this.deps.now()
      );
    }

    return {
      actionResult: {
        action: input.action,
        method: input.action === "clipboard_read" ? "clipboard-read" : "clipboard-write",
        durationMs: this.deps.now() - started,
      },
      observation: null,
      newObservationId: null,
      changedWindow: null,
      uiChanged: null,
      ...(clipboardText !== undefined ? { clipboardText } : {}),
    };
  }

  /** V2.5：文件上传 —— 授权工作区文件 + 系统文件选择对话框（路径绝不外泄） */
  private async runUploadAction(
    input: NormalizedActionInput,
    record: DesktopObservationRecord,
    elementRef: ObservedElementRef | null
  ): Promise<NativeGuiActionResult> {
    const grant = input.fileGrant;
    if (!grant) return { ok: false, reason: "missing-file" };
    const absolutePath = this.deps.resolveUploadPath?.(grant.grantId, grant.path) ?? null;
    if (!absolutePath) return { ok: false, reason: "file-not-authorized" };

    const fileDialog = this.isFileDialog({
      appName: record.appName,
      windowTitle: record.windowTitle,
      elementNames: Array.from(record.elementRefs.values()).map((ref) => ref.name),
    });
    if (!fileDialog) return { ok: false, reason: "not-file-dialog" };

    const hwnd = this.requireWindowHwnd(record);
    const typeResult = await this.deps.runGuiAction({
      hwnd,
      nativeRef: elementRef?.nativeRef ?? null,
      ...(elementRef ? { expectedBounds: elementRef.bounds } : {}),
      action: "type",
      text: absolutePath,
    });
    if (!typeResult.ok) return typeResult;
    const keyResult = await this.deps.runGuiAction({ hwnd, nativeRef: null, action: "key", vk: [0x0d] });
    if (!keyResult.ok) return keyResult;
    return { ok: true, method: "upload-path" };
  }

  /** V2.5：动作目标 → 绝对像素点（元素中心 / 归一化坐标） */
  private resolvePointForTarget(
    target: NormalizedActionTarget,
    record: DesktopObservationRecord
  ): { x: number; y: number } {
    if (target.elementId !== undefined) {
      const ref = record.elementRefs.get(target.elementId);
      if (!ref) {
        throw new DesktopComputerIpcError("STALE_OBSERVATION", "目标元素已不存在，请重新 observe_desktop。");
      }
      return this.elementCenter(ref.bounds);
    }
    if (target.normalized !== undefined) {
      return this.normalizedToPoint(target.normalized, record);
    }
    throw new DesktopComputerIpcError("INVALID_OPERATION", "动作目标不合法。");
  }

  private elementCenter(bounds: { x: number; y: number; width: number; height: number }): {
    x: number;
    y: number;
  } {
    return {
      x: Math.round(bounds.x + Math.floor(bounds.width / 2)),
      y: Math.round(bounds.y + Math.floor(bounds.height / 2)),
    };
  }

  /** V2.5：窗口物理 bounds（drag 边界校验基准） */
  private windowBoundsFor(record: DesktopObservationRecord): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    const window = record.windowId ? this.registry.resolve(record.windowId, this.deps.now()) : null;
    if (window) return { ...window.bounds };
    return record.coordinateBounds ?? { x: 0, y: 0, width: 0, height: 0 };
  }

  private isInsideBounds(
    point: { x: number; y: number },
    bounds: { x: number; y: number; width: number; height: number }
  ): boolean {
    return (
      point.x >= bounds.x &&
      point.y >= bounds.y &&
      point.x < bounds.x + bounds.width &&
      point.y < bounds.y + bounds.height
    );
  }

  /** V2.5：文件选择对话框识别（deps 可注入；默认纯函数实现） */
  private isFileDialog(input: {
    appName?: string | null;
    windowTitle?: string | null;
    elementNames?: string[];
  }): boolean {
    return (this.deps.isFileDialog ?? isSystemFileDialog)(input);
  }

  /** V2.1：expect 求值（elementDisappears 用 nativeRef 稳定身份比较） */
  private evaluateExpectation(    expectation: NonNullable<NormalizedActionInput["expect"]>,
    observation: ClassFlowDesktopComputerObservation,
    record: DesktopObservationRecord | null,
    disappearedNativeRef: string | null
  ): VerificationResult {
    const newNativeRefs = new Set<string>();
    if (record) {
      for (const ref of record.elementRefs.values()) newNativeRefs.add(ref.nativeRef);
    }
    return evaluateActionExpectation({
      expectation,
      newWindowTitle: observation.windowTitle,
      newAppName: observation.appName,
      newElements: observation.elements,
      disappearedNativeRef,
      newNativeRefs,
    });
  }

  /** 动作指纹（repeated-action 检测；不包含原始输入文本，只含长度与短哈希） */
  private actionFingerprint(input: NormalizedActionInput): string {
    const target =
      input.target?.elementId ??
      (input.target?.normalized
        ? `${input.target.normalized.x.toFixed(2)},${input.target.normalized.y.toFixed(2)}`
        : "focus");
    const to =
      input.to !== undefined
        ? input.to.elementId ??
          (input.to.normalized
            ? `${input.to.normalized.x.toFixed(2)},${input.to.normalized.y.toFixed(2)}`
            : "to")
        : "";
    let textPart = "";
    if (input.action === "type" && input.text) {
      let hash = 0;
      for (let i = 0; i < input.text.length; i++) hash = (hash * 31 + input.text.charCodeAt(i)) >>> 0;
      textPart = `:${input.text.length}:${hash.toString(16)}`;
    }
    const filePart =
      input.action === "upload_file" && input.fileGrant
        ? `:${input.fileGrant.grantId.slice(0, 8)}:${input.fileGrant.path.length}`
        : "";
    return `${input.action}:${target}${to ? `->${to}` : ""}${textPart}${filePart}`;
  }

  /** Session 可用性（不计数）：cancelled / paused / failed 拒绝 */
  private assertSessionUsable(sessionId: string | undefined): void {
    if (!sessionId) return;
    const status = this.sessions.get(sessionId, this.deps.now());
    if (!status) return;
    if (status.state === "cancelled") {
      throw new DesktopComputerIpcError("CANCELLED", "用户已停止电脑操作。");
    }
    if (status.state === "paused") {
      throw new DesktopComputerIpcError("SESSION_PAUSED", "电脑操作已暂停。");
    }
    if (status.state === "failed") {
      throw new DesktopComputerIpcError(
        "SESSION_LIMIT_REACHED",
        status.failureReason ?? "本会话已停止。"
      );
    }
  }

  /** Emergency Stop：标记 session cancelled + 清空该 session observation */
  cancelActions(rawInput: unknown): { ok: boolean; cancelled: number } {
    const { sessionId } = normalizeSessionOnlyInput(rawInput);
    this.sessions.cancel(sessionId, this.deps.now());
    const cancelled = this.store.cancelSession(sessionId);
    return { ok: true, cancelled };
  }

  /**
   * V2.1：在当前 observation 已收集的控件里做确定性语义检索。
   * 只读：不触发新的 UIA 扫描；返回 elementId 供 desktop_action 使用。
   */
  findElements(rawInput: unknown): ClassFlowDesktopComputerElementSearchResult {
    const input = normalizeFindElementsInput(rawInput);
    this.assertWindowsPlatform();
    const now = this.deps.now();
    const record = this.store.get(input.observationId, now);
    if (!record) {
      throw new DesktopComputerIpcError("STALE_OBSERVATION", "观察已过期，请重新 observe_desktop。");
    }
    if (input.sessionId && record.sessionId && input.sessionId !== record.sessionId) {
      throw new DesktopComputerIpcError("STALE_OBSERVATION", "观察属于其它会话，请重新 observe_desktop。");
    }
    const searchable = Array.from(record.elementRefs.entries()).map(([elementId, ref]) => ({
      elementId,
      role: ref.role,
      name: ref.name,
      enabled: ref.enabled,
      focused: ref.focused,
    }));
    const matches = searchObservationElements(searchable, input.query, input.maxResults).map((match) => {
      const ref = record.elementRefs.get(match.elementId)!;
      return {
        elementId: match.elementId,
        role: match.role,
        name: match.name,
        enabled: match.enabled,
        focused: match.focused,
        bounds: { ...ref.bounds },
        score: match.score,
      };
    });
    return {
      observationId: record.id,
      query: input.query,
      matches,
      totalElements: record.elementRefs.size,
    };
  }

  /** Phase 3：多窗口列表（opaque session-local windowId + z-order） */
  async listWindows(rawInput: unknown): Promise<ClassFlowDesktopComputerWindowList> {
    const { sessionId } = normalizeOptionalSessionInput(rawInput);
    this.assertWindowsPlatform();
    const now = this.deps.now();
    if (sessionId) {
      try {
        this.sessions.beginObserve(sessionId, now);
      } catch (err) {
        throw this.mapSessionGuardError(err);
      }
    }
    let windows: NativeWindowRecord[];
    try {
      windows = await this.deps.listWindows();
    } catch {
      throw new DesktopComputerIpcError("OBSERVATION_FAILED", "窗口枚举失败");
    }
    this.registry.sync(windows, now);
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
        zOrder: window.zIndex,
      });
    }
    const focused = windows.find((window) => window.isActive) ?? null;
    const focusedWindowId = focused ? this.registry.opaqueIdFor(focused.hwnd) : null;
    if (sessionId) {
      this.sessions.endObserve(
        sessionId,
        {
          appName: focused?.appName ?? null,
          windowTitle: focused?.title ?? null,
          uiSignature: `windows:${publicWindows.map((w) => `${w.windowId}:${w.zOrder ?? 0}`).join(",")}`,
          appProfile: desktopAppProfileInfo(
            resolveDesktopAppProfile({ appName: focused?.appName ?? "", windowTitle: focused?.title ?? "" })
          ),
        },
        now
      );
    }
    return {
      focusedWindowId,
      activeApplication: focused?.appName ?? "",
      windows: publicWindows,
      windowsTruncated: windows.length > publicWindows.length,
    };
  }

  /** Phase 3：激活窗口（activate → observe → action 工作流） */
  async activateWindow(rawInput: unknown): Promise<{
    windowId: string;
    appName: string;
    windowTitle: string;
    activated: boolean;
    session?: ClassFlowDesktopComputerSessionStatus;
  }> {
    const input = normalizeActivateWindowInput(rawInput);
    this.assertWindowsPlatform();
    const now = this.deps.now();
    const fingerprint = `window:activate:${input.windowId}`;
    if (input.sessionId) {
      try {
        this.sessions.beginAction(
          input.sessionId,
          { fingerprint, actionLabel: `切换到窗口 ${input.windowId}`, appName: null, windowTitle: null },
          now
        );
      } catch (err) {
        throw this.mapSessionGuardError(err);
      }
    }
    let windows: NativeWindowRecord[];
    try {
      windows = await this.deps.listWindows();
    } catch {
      throw new DesktopComputerIpcError("OBSERVATION_FAILED", "窗口枚举失败");
    }
    this.registry.sync(windows, now);
    const target = this.registry.resolve(input.windowId, now);
    if (!target) {
      if (input.sessionId) {
        this.sessions.endAction(input.sessionId, { beforeUiSignature: null, newUiSignature: null, ok: false, actionFingerprint: fingerprint }, now);
      }
      throw new DesktopComputerIpcError("STALE_OBSERVATION", "目标窗口已不存在，请重新 list_desktop_windows。");
    }
    let activated = false;
    try {
      activated = await this.deps.activateWindow(target.hwnd);
    } catch {
      activated = false;
    }
    if (input.sessionId) {
      this.sessions.endAction(input.sessionId, { beforeUiSignature: null, newUiSignature: null, ok: activated, actionFingerprint: fingerprint }, this.deps.now());
    }
    if (!activated) {
      throw new DesktopComputerIpcError("ACTION_FAILED", "窗口激活失败（可能被系统前台锁定）。");
    }
    return {
      windowId: input.windowId,
      appName: target.appName,
      windowTitle: target.title,
      activated: true,
      ...(input.sessionId
        ? { session: this.sessions.get(input.sessionId, this.deps.now()) ?? undefined }
        : {}),
    };
  }

  /** Phase 3：打开应用（logical app id + allowlist 解析；绝不接受 exe 路径） */
  async openApplication(rawInput: unknown): Promise<ClassFlowDesktopComputerAppLaunchResult> {
    const input = normalizeOpenApplicationInput(rawInput);
    this.assertWindowsPlatform();
    const started = this.deps.now();
    const appId = normalizeDesktopAppId(input.app);
    const fingerprint = `app:open:${appId ?? "unknown"}`;
    if (input.sessionId) {
      try {
        this.sessions.beginAction(
          input.sessionId,
          {
            fingerprint,
            actionLabel: `打开应用 ${appId ? desktopAppLabel(appId) : input.app}`,
            appName: null,
            windowTitle: null,
          },
          started
        );
      } catch (err) {
        throw this.mapSessionGuardError(err);
      }
    }
    if (!appId) {
      if (input.sessionId) {
        this.sessions.endAction(input.sessionId, { beforeUiSignature: null, newUiSignature: null, ok: false, actionFingerprint: fingerprint }, this.deps.now());
      }
      throw new DesktopComputerIpcError(
        "APP_NOT_FOUND",
        "应用不在允许列表中。请使用逻辑应用名（例如 chrome / word / wechat），不要使用路径或 exe。"
      );
    }
    const label = desktopAppLabel(appId);
    let resolved: ResolvedDesktopApp;
    try {
      resolved = await this.deps.resolveApp(appId);
    } catch {
      resolved = { kind: "none" };
    }
    if (resolved.kind === "none") {
      if (input.sessionId) {
        this.sessions.endAction(input.sessionId, { beforeUiSignature: null, newUiSignature: null, ok: false, actionFingerprint: fingerprint }, this.deps.now());
      }
      throw new DesktopComputerIpcError("APP_NOT_FOUND", `未在本机找到应用：${label}`);
    }
    if (!this.deps.launchApp(resolved)) {
      if (input.sessionId) {
        this.sessions.endAction(input.sessionId, { beforeUiSignature: null, newUiSignature: null, ok: false, actionFingerprint: fingerprint }, this.deps.now());
      }
      throw new DesktopComputerIpcError("APP_LAUNCH_FAILED", `应用启动失败：${label}`);
    }

    // 等待新窗口出现（默认 app 可能已在运行 → 视为成功激活已有窗口）
    const hints = new Set(DESKTOP_APP_ALLOWLIST[appId]?.processHints ?? []);
    // V2.4：应用画像决定首轮等待与轮询间隔（重应用更耐心）
    const launchProfile = resolveDesktopAppProfile({
      appName: DESKTOP_APP_ALLOWLIST[appId]?.processHints[0] ?? appId,
    });
    const firstWait = desktopAppReadyWaitMs(launchProfile);
    const pollWait = Math.max(200, desktopAppSettleMs(launchProfile));
    let windowId: string | undefined;
    const deadline = started + 8_000;
    let waited = 0;
    while (this.deps.now() < deadline) {
      await this.deps.sleep(waited === 0 ? firstWait : pollWait);
      waited += 1;
      let windows: NativeWindowRecord[];
      try {
        windows = await this.deps.listWindows();
      } catch {
        continue;
      }
      this.registry.sync(windows, this.deps.now());
      const match = windows.find((window) => hints.has(window.appName.toLowerCase()));
      if (match) {
        windowId = this.registry.opaqueIdFor(match.hwnd) ?? undefined;
        break;
      }
    }
    if (input.sessionId) {
      this.sessions.endAction(
        input.sessionId,
        { beforeUiSignature: null, newUiSignature: null, ok: true, actionFingerprint: fingerprint },
        this.deps.now()
      );
    }
    return {
      appId,
      label,
      launched: true,
      ...(windowId ? { windowId } : {}),
      elapsedMs: this.deps.now() - started,
    };
  }

  getSessionStatus(rawInput: unknown): ClassFlowDesktopComputerSessionStatus {
    const { sessionId } = normalizeSessionOnlyInput(rawInput);
    return this.sessions.ensure(sessionId, this.deps.now());
  }

  pauseSession(rawInput: unknown): ClassFlowDesktopComputerSessionStatus {
    const { sessionId } = normalizeSessionOnlyInput(rawInput);
    return this.sessions.pause(sessionId, this.deps.now());
  }

  resumeSession(rawInput: unknown): ClassFlowDesktopComputerSessionStatus {
    const { sessionId } = normalizeSessionOnlyInput(rawInput);
    return this.sessions.resume(sessionId, this.deps.now());
  }

  completeSession(rawInput: unknown): ClassFlowDesktopComputerSessionStatus {
    const { sessionId } = normalizeSessionOnlyInput(rawInput);
    const now = this.deps.now();
    const completed = this.sessions.completeExisting(sessionId, now);
    if (completed) return completed;
    // 未使用过的 session：返回 transient idle 状态（不创建记录）
    return {
      sessionId,
      state: "idle",
      createdAt: now,
      updatedAt: now,
      elapsedMs: 0,
      actions: 0,
      observations: 0,
      remainingActions: DESKTOP_SESSION_LIMITS.maxActions,
      appName: null,
      windowTitle: null,
      actionLabel: null,
      failureReason: null,
      goal: null,
      plan: [],
      stepIndex: 0,
      reflectionRequired: false,
      appProfile: null,
    };
  }

  setSessionState(rawInput: unknown): ClassFlowDesktopComputerSessionStatus {
    const input = normalizeSessionStateInput(rawInput);
    this.sessions.setState(input.sessionId, input.state, this.deps.now());
    return this.sessions.ensure(input.sessionId, this.deps.now());
  }

  /**
   * V2.3：设置目标 / 计划 / 当前步骤（只存内存；更新计划视为一次重新规划 → 消费 reflectionRequired）。
   */
  updateSessionPlan(rawInput: unknown): ClassFlowDesktopComputerSessionStatus {
    const input = normalizeSessionPlanInput(rawInput);
    return this.sessions.updatePlan(
      input.sessionId,
      {
        ...(input.goal !== undefined ? { goal: input.goal } : {}),
        ...(input.plan !== undefined ? { plan: input.plan } : {}),
        ...(input.stepIndex !== undefined ? { stepIndex: input.stepIndex } : {}),
        ...(input.completeStep !== undefined ? { completeStep: input.completeStep } : {}),
      },
      this.deps.now()
    );
  }

  /**
   * V2.6：成功轨迹 → 确定性 Skill 草稿（desktop-<app>-<task>）。
   * 只读取 Session 内的结构化轨迹；不含输入文本 / 路径 / 截图。
   */
  buildSkillDraft(rawInput: unknown): { draft: SkillDraft; steps: number } {
    const { sessionId } = normalizeSessionOnlyInput(rawInput);
    const trajectory = this.sessions.trajectorySnapshot(sessionId, this.deps.now());
    if (!trajectory || trajectory.steps.length < MIN_TRAJECTORY_STEPS_FOR_SKILL) {
      throw new DesktopComputerIpcError(
        "INVALID_OPERATION",
        `轨迹步骤太少（至少 ${MIN_TRAJECTORY_STEPS_FOR_SKILL} 步操作才能生成 Skill）。`
      );
    }
    if (trajectory.result !== "completed") {
      throw new DesktopComputerIpcError("INVALID_OPERATION", "只有成功完成的轨迹才能生成 Skill。");
    }
    return { draft: buildDesktopSkillDraft(trajectory, sessionId), steps: trajectory.steps.length };
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
        if (this.deps.resolveUiElement) {
          current = await this.deps.resolveUiElement(window?.hwnd ?? 0, stored.nativeRef);
        } else {
          const tree = await this.deps.inspectUiTree(window?.hwnd ?? 0);
          current = tree.elements.find((element) => element.nativeRef === stored.nativeRef) ?? null;
        }
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

  /** 惰性/定时清理过期 observation（含 elementId → native 映射）+ 终态 session */
  sweepObservations(now: number = this.deps.now()): number {
    const removedObservations = this.store.sweep(now);
    this.sessions.sweep(now);
    return removedObservations;
  }

  /** 测试/诊断：当前 store / registry / session 规模（不含任何 native 标识） */
  stats(): { observations: number; windows: number; sessions: number } {
    return {
      observations: this.store.size(),
      windows: this.registry.size(),
      sessions: this.sessions.size(),
    };
  }
}

let singleton: DesktopObservationRuntime | null = null;

/** Main 进程单例（ipc.ts 使用；默认 deps 含 electron 动态加载） */
export async function getDesktopObservationRuntime(): Promise<DesktopObservationRuntime> {
  if (singleton) return singleton;
  singleton = new DesktopObservationRuntime(await buildDefaultDeps());
  return singleton;
}
