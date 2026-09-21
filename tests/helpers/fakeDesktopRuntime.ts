/**
 * Computer Use Phase 3 — Fake Desktop Runtime（CI 不依赖真实 Windows UI）。
 *
 * 在内存中模拟 desktop bridge v3 的完整表面（observe / prepareAction / action /
 * listWindows / activateWindow / openApplication / session 生命周期），
 * 并提供可脚本化的世界状态（点击 → UI 变化）用于多步骤 integration tests。
 */
import { vi } from "vitest";
import type {
  ClassFlowDesktopComputerActionPreparation,
  ClassFlowDesktopComputerActionResult,
  ClassFlowDesktopComputerObservation,
  ClassFlowDesktopComputerSessionEvent,
  ClassFlowDesktopComputerSessionStatus,
  ClassFlowDesktopComputerWindow,
  ClassFlowDesktopComputerWindowList,
  DesktopControlSessionState,
} from "@/lib/desktop/types";
import { classifyGuiAction } from "@/lib/ai/computer/gui/risk";
import { searchObservationElements } from "@/lib/ai/computer/desktop/elementSearch";
import {
  desktopAppProfileInfo,
  desktopAppProfileRiskHint,
  resolveDesktopAppProfile,
} from "@/src/main/computer/appProfiles";
import { isSystemFileDialog } from "@/src/main/computer/upload";
import {
  MIN_TRAJECTORY_STEPS_FOR_SKILL,
  buildDesktopSkillDraft,
  type DesktopTrajectoryStep,
} from "@/src/main/computer/trajectory";

export interface FakeElement {
  elementId: string;
  role: string;
  name: string;
  enabled?: boolean;
  focused?: boolean;
  isPassword?: boolean;
  bounds: { x: number; y: number; width: number; height: number };
  /** 点击行为（可选）：改变世界状态 */
  onClick?: (world: FakeDesktopWorld) => void;
  /** V2.5：右键行为（可选）：打开上下文菜单等 */
  onRightClick?: (world: FakeDesktopWorld) => void;
}

export interface FakeWindow {
  windowId: string;
  title: string;
  appName: string;
  elements: FakeElement[];
  /** 是否已最小化（activate 后置 false） */
  minimized?: boolean;
}

interface ObservationRecord {
  observationId: string;
  windowId: string;
  elements: Map<string, FakeElement>;
  viewport: { width: number; height: number };
  revision: number;
  createdAt: number;
}

const SESSION_LIMITS = { maxActions: 30, maxObservations: 60 };

export class FakeDesktopWorld {
  windows: FakeWindow[] = [];
  activeWindowId: string | null = null;
  /** 键盘输入落点（type/key 目标） */
  focusedField: { windowId: string; elementId: string } | null = null;
  /** 最近一次输入文本（场景脚本用） */
  typedText: string | null = null;
  /** V2.5：剪贴板内容（fake 世界） */
  clipboardText: string | null = null;
  /** V2.5：upload_file 记录（grantId + 逻辑路径） */
  readonly uploadedFiles: Array<{ grantId: string; path: string }> = [];
  /** V2.5：最近一次特殊动作（hover / right_click / drag / upload_file） */
  lastAction: string | null = null;
  /** V2.6：轨迹（结构化事实；与 Main 相同语义） */
  readonly trajectory: DesktopTrajectoryStep[] = [];
  /** 最近一次 Enter 的窗口（脚本化行为） */
  onEnter: ((world: FakeDesktopWorld) => void) | null = null;
  private observations = new Map<string, ObservationRecord>();
  private obsSeq = 0;
  private revision = 0;
  private staleWindows = new Set<string>();
  private visionCandidates: Array<{ label: string; confidence: number; bounds: { x: number; y: number; width: number; height: number } }> = [];
  /** 已消息记录（聊天场景验证） */
  sentMessages: string[] = [];
  /** 启动过的应用 */
  launchedApps: string[] = [];
  private listeners = new Set<(event: ClassFlowDesktopComputerSessionEvent) => void>();
  private session: ClassFlowDesktopComputerSessionStatus | null = null;
  private prevSignature: string | null = null;
  private noProgress = 0;
  /** V2.3：连续 expect 验证失败计数（≥2 → reflectionRequired） */
  private verificationFailStreak = 0;
  readonly log: Array<{ tool: string; input: unknown }> = [];

  constructor(windows: FakeWindow[], activeWindowId?: string) {
    this.windows = windows;
    this.activeWindowId = activeWindowId ?? windows[0]?.windowId ?? null;
  }

  addWindow(window: FakeWindow, activate = false): void {
    this.windows.push(window);
    if (activate) this.activeWindowId = window.windowId;
  }

  removeWindow(windowId: string): void {
    this.windows = this.windows.filter((w) => w.windowId !== windowId);
    if (this.activeWindowId === windowId) this.activeWindowId = this.windows[0]?.windowId ?? null;
  }

  markStale(windowId: string): void {
    this.staleWindows.add(windowId);
  }

  setVisionCandidates(
    candidates: Array<{ label: string; confidence: number; bounds: { x: number; y: number; width: number; height: number } }>
  ): void {
    this.visionCandidates = candidates;
  }

  getActiveWindow(): FakeWindow | null {
    return this.windows.find((w) => w.windowId === this.activeWindowId) ?? null;
  }

  private signature(window: FakeWindow): string {
    return `${window.windowId}:${window.elements.map((e) => `${e.elementId}:${e.name}:${e.bounds.x},${e.bounds.y}`).join("|")}`;
  }

  private emitSession(state: DesktopControlSessionState, actionLabel: string | null): void {
    const window = this.getActiveWindow();
    this.session = {
      sessionId: this.session?.sessionId ?? "cs-fake-0000-0000-0000-0000",
      state,
      createdAt: this.session?.createdAt ?? 0,
      updatedAt: Date.now(),
      elapsedMs: 0,
      actions: this.session?.actions ?? 0,
      observations: this.session?.observations ?? 0,
      remainingActions: SESSION_LIMITS.maxActions - (this.session?.actions ?? 0),
      appName: window?.appName ?? null,
      windowTitle: window?.title ?? null,
      actionLabel,
      failureReason: state === "failed" ? "no-progress" : null,
      goal: this.session?.goal ?? null,
      plan: this.session?.plan ?? [],
      stepIndex: this.session?.stepIndex ?? 0,
      reflectionRequired: this.session?.reflectionRequired ?? false,
      appProfile:
        this.session?.appProfile ??
        desktopAppProfileInfo(
          resolveDesktopAppProfile({ appName: window?.appName ?? "", windowTitle: window?.title ?? "" })
        ),
    };
    for (const listener of this.listeners) listener({ type: "session", ...this.session });
  }

  private ensureSession(sessionId: string): void {
    if (!this.session) {
      this.session = {
        sessionId,
        state: "idle",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        elapsedMs: 0,
        actions: 0,
        observations: 0,
        remainingActions: SESSION_LIMITS.maxActions,
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
  }

  // ---------- bridge methods ----------

  capabilities = vi.fn(async () => ({
    available: true,
    platform: "windows" as const,
    screenshot: true,
    uiAutomation: true,
    action: true,
    session: true,
    appControl: true,
  }));

  listWindows = vi.fn(async (_input?: unknown): Promise<ClassFlowDesktopComputerWindowList> => {    const focused = this.getActiveWindow();
    return {
      focusedWindowId: focused?.windowId ?? null,
      activeApplication: focused?.appName ?? "",
      windows: this.windows.map((w, index) => ({
        windowId: w.windowId,
        title: w.title,
        appName: w.appName,
        active: w.windowId === this.activeWindowId,
        zOrder: index,
      })),
      windowsTruncated: false,
    };
  });

  /** V2.1：控件检索（与 Main 同一打分实现） */
  findElements = vi.fn(
    async (input: { observationId: string; query: string; maxResults?: number; sessionId?: string }) => {
      const record = this.observations.get(input.observationId);
      if (!record) throw { code: "STALE_OBSERVATION", message: "观察已过期" };
      const searchable = [...record.elements.entries()].map(([elementId, element]) => ({
        elementId,
        role: element.role,
        name: element.name,
        enabled: element.enabled !== false,
        focused: element.focused === true,
      }));
      const matches = searchObservationElements(searchable, input.query, input.maxResults ?? 5).map((match) => {
        const element = record.elements.get(match.elementId)!;
        return {
          elementId: match.elementId,
          role: match.role,
          name: match.name,
          enabled: match.enabled,
          focused: match.focused,
          bounds: element.bounds,
          score: match.score,
        };
      });
      return {
        observationId: record.observationId,
        query: input.query,
        matches,
        totalElements: record.elements.size,
      };
    }
  );

  observe = vi.fn(async (input?: { target?: string; windowId?: string; includeUiTree?: boolean; sessionId?: string }) => {
    const window = input?.windowId
      ? this.windows.find((w) => w.windowId === input.windowId) ?? null
      : this.getActiveWindow();
    // 新观察 = 最新 UI 事实 → 清除该窗口的 stale 标记（模拟重新观察后恢复可操作）
    if (window) this.staleWindows.delete(window.windowId);
    this.obsSeq += 1;
    this.revision += 1;
    const elements = window ? window.elements.map((element) => ({ ...element })) : [];
    const record: ObservationRecord = {
      observationId: `obs-fake-${this.obsSeq}`,
      windowId: window?.windowId ?? "",
      elements: new Map(elements.map((element) => [element.elementId, element])),
      viewport: { width: 1280, height: 800 },
      revision: this.revision,
      createdAt: Date.now(),
    };
    this.observations.set(record.observationId, record);
    this.prevSignature = window ? this.signature(window) : null;
    if (input?.sessionId) {
      this.ensureSession(input.sessionId);
      this.emitSession("observing", null);
      this.session!.state = "idle";
    }
    return this.buildObservation(record, window);
  });

  private buildObservation(record: ObservationRecord, window: FakeWindow | null): ClassFlowDesktopComputerObservation {
    // V2.4：应用画像（与 Main 同一纯函数实现）
    const profile = resolveDesktopAppProfile({
      appName: window?.appName ?? "",
      windowTitle: window?.title ?? "",
    });
    return {
      observationId: record.observationId,
      target: "active-window",
      appName: window?.appName ?? "",
      windowTitle: window?.title ?? "",
      windowId: window?.windowId ?? null,
      activeApplication: this.getActiveWindow()?.appName ?? "",
      focusedWindow: this.activeWindowId,
      viewport: record.viewport,
      windows: this.windows.map((w, index) => ({
        windowId: w.windowId,
        title: w.title,
        appName: w.appName,
        active: w.windowId === this.activeWindowId,
        zOrder: index,
      })),
      windowsTruncated: false,
      elements: [...record.elements.values()].map((element) => ({
        elementId: element.elementId,
        role: element.role,
        name: element.name,
        enabled: element.enabled !== false,
        focused: element.focused === true,
        isPassword: element.isPassword === true,
        bounds: element.bounds,
      })),
      elementCount: record.elements.size,
      elementsTruncated: false,
      screenshot: {
        captured: true,
        mimeType: "image/jpeg",
        width: 1280,
        height: 800,
        bytes: 1024,
        capturedAt: new Date().toISOString(),
        dataUrl: "data:image/jpeg;base64,AAAA",
      },
      warnings: profile?.blocked ? ["app-profile-blocked"] : [],
      uiTreeRevision: record.revision,
      capturedAt: new Date().toISOString(),
      appProfile: desktopAppProfileInfo(profile),
    };
  }

  prepareAction = vi.fn(async (input: {
    action: string;
    observationId?: string;
    target?: { elementId?: string; normalized?: { x: number; y: number } };
    to?: { elementId?: string; normalized?: { x: number; y: number } };
    text?: string;
    key?: string;
    scroll?: number;
    axis?: "vertical" | "horizontal";
    clipboardAllowed?: boolean;
    fileGrant?: { grantId: string; path: string };
    sessionId?: string;
  }): Promise<ClassFlowDesktopComputerActionPreparation> => {
    this.log.push({ tool: "prepareAction", input });
    // V2.5：剪贴板动作无 observation 绑定
    if (input.action === "clipboard_read" || input.action === "clipboard_write") {
      const risk = classifyGuiAction({
        action: input.action as never,
        target: { kind: "none", appName: "", windowTitle: "" },
        clipboardAllowed: input.clipboardAllowed === true,
      });
      return {
        action: input.action as never,
        risk: { level: risk.level, reason: risk.reason },
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
      };
    }
    const record = input.observationId ? this.observations.get(input.observationId) : null;
    if (!record) throw { code: "STALE_OBSERVATION", message: "观察已过期" };
    const window = this.windows.find((w) => w.windowId === record.windowId) ?? null;
    if (!window) throw { code: "STALE_OBSERVATION", message: "窗口已关闭" };
    if (this.staleWindows.has(window.windowId)) {
      throw { code: "STALE_OBSERVATION", message: "界面已变化" };
    }
    const element = input.target?.elementId ? record.elements.get(input.target.elementId) ?? null : null;
    if (input.target?.elementId && !element) {
      throw { code: "STALE_OBSERVATION", message: "元素已消失" };
    }
    const risk = classifyGuiAction({
      action: input.action as never,
      ...(input.text !== undefined ? { text: input.text } : {}),
      ...(input.key !== undefined ? { key: input.key } : {}),
      target: {
        kind: element ? "element" : input.target?.normalized ? "coordinates" : "none",
        ...(element ? { role: element.role, name: element.name } : {}),
        isPassword: element?.isPassword === true,
        appName: window.appName,
        windowTitle: window.title,
      },
      // V2.4：应用画像参与风险（blocked 应用 / 应用内高风险控件）
      ...(() => {
        const hint = desktopAppProfileRiskHint(
          resolveDesktopAppProfile({ appName: window.appName, windowTitle: window.title })
        );
        return hint ? { profile: hint } : {};
      })(),
      // V2.5：upload_file 的文件对话框事实（与 Main 同一纯函数实现）
      ...(input.action === "upload_file"
        ? {
            fileDialog: isSystemFileDialog({
              appName: window.appName,
              windowTitle: window.title,
              elementNames: [...record.elements.values()].map((e) => e.name),
            }),
          }
        : {}),
    });
    return {
      action: input.action as never,
      risk: { level: risk.level, reason: risk.reason },
      target: {
        kind: element ? "element" : input.target?.normalized ? "coordinates" : "none",
        ...(element ? { elementId: element.elementId, role: element.role, name: element.name, isPassword: element.isPassword === true } : {}),
        appName: window.appName,
        windowTitle: window.title,
        windowId: window.windowId,
        targetLabel: element ? `${element.role}「${element.name}」` : "目标",
      },
      observationId: record.observationId,
      textPreview: risk.textPreview,
      requiresObservation: true,
    };
  });

  action = vi.fn(async (input: {
    action: string;
    observationId?: string;
    target?: { elementId?: string; normalized?: { x: number; y: number } };
    to?: { elementId?: string; normalized?: { x: number; y: number } };
    text?: string;
    key?: string;
    scroll?: number;
    axis?: "vertical" | "horizontal";
    clipboardAllowed?: boolean;
    clipboardText?: string;
    fileGrant?: { grantId: string; path: string };
    sessionId?: string;
    expect?: {
      elementAppears?: { role?: string; nameContains?: string; nameEquals?: string };
      elementDisappears?: { elementId: string };
      titleContains?: string;
      windowAppears?: { appName?: string };
      textAppears?: string;
    };
  }): Promise<ClassFlowDesktopComputerActionResult> => {
    this.log.push({ tool: "action", input });
    if (input.action === "wait") {
      return {
        actionResult: { action: "wait", method: "wait", durationMs: 100 },
        observation: null,
        newObservationId: null,
        changedWindow: null,
        uiChanged: null,
      };
    }
    // V2.5：剪贴板（无 observation 绑定；与 Main 相同：未开启 → ACTION_BLOCKED）
    if (input.action === "clipboard_read" || input.action === "clipboard_write") {
      if (input.clipboardAllowed !== true) {
        throw { code: "ACTION_BLOCKED", message: "用户尚未开启剪贴板访问" };
      }
      this.ensureSession(input.sessionId ?? "cs-fake");
      this.emitSession("acting", input.action);
      this.session!.actions += 1;
      this.trajectory.push({
        index: this.trajectory.length,
        action: input.action as never,
        targetLabel: input.action === "clipboard_read" ? "剪贴板（读取）" : "剪贴板（覆盖写入）",
        risk: "sensitive",
        verificationPassed: null,
        at: Date.now(),
      });
      if (input.action === "clipboard_write") {
        this.clipboardText = input.clipboardText ?? null;
        return {
          actionResult: { action: input.action as never, method: "clipboard-write" as never, durationMs: 20 },
          observation: null,
          newObservationId: null,
          changedWindow: null,
          uiChanged: null,
        };
      }
      return {
        actionResult: { action: input.action as never, method: "clipboard-read" as never, durationMs: 20 },
        observation: null,
        newObservationId: null,
        changedWindow: null,
        uiChanged: null,
        clipboardText: this.clipboardText ?? "",
      };
    }
    const record = input.observationId ? this.observations.get(input.observationId) : null;
    if (!record) throw { code: "STALE_OBSERVATION", message: "观察已过期" };
    const window = this.windows.find((w) => w.windowId === record.windowId) ?? null;
    if (!window || this.staleWindows.has(window.windowId)) {
      throw { code: "STALE_OBSERVATION", message: "界面已变化" };
    }
    const element = input.target?.elementId ? record.elements.get(input.target.elementId) ?? null : null;
    const beforeSignature = this.signature(window);

    if (input.action === "click" || input.action === "double_click") {
      this.ensureSession(input.sessionId ?? "cs-fake");
      this.emitSession("acting", `${input.action} ${element?.elementId ?? ""}`);
      this.session!.actions += 1;
      element?.onClick?.(this);
    } else if (input.action === "focus") {
      this.focusedField = element ? { windowId: window.windowId, elementId: element.elementId } : null;
    } else if (input.action === "type") {
      this.ensureSession(input.sessionId ?? "cs-fake");
      this.emitSession("acting", `type ${element?.elementId ?? ""}`);
      this.session!.actions += 1;
      if (!element) throw { code: "ACTION_FAILED", message: "没有可输入的目标" };
      this.typedText = input.text ?? null;
    } else if (input.action === "key") {
      this.ensureSession(input.sessionId ?? "cs-fake");
      this.emitSession("acting", `key ${input.key ?? ""}`);
      this.session!.actions += 1;
      if ((input.key ?? "").toLowerCase() === "enter") this.onEnter?.(this);
    } else if (input.action === "scroll") {
      // 无 UI 变化（用于 no-progress 场景）
    } else if (input.action === "hover" || input.action === "right_click" || input.action === "drag") {
      this.ensureSession(input.sessionId ?? "cs-fake");
      this.emitSession("acting", `${input.action} ${element?.elementId ?? ""}`);
      this.session!.actions += 1;
      if (input.action === "right_click" && element) {
        this.lastAction = "right_click";
        element.onRightClick?.(this);
      }
      if (input.action === "drag" && element) this.lastAction = "drag";
    } else if (input.action === "upload_file") {
      this.ensureSession(input.sessionId ?? "cs-fake");
      this.emitSession("acting", "upload_file");
      this.session!.actions += 1;
      if (!input.fileGrant) throw { code: "ACTION_BLOCKED", message: "缺少工作区文件" };
      this.uploadedFiles.push({ grantId: input.fileGrant.grantId, path: input.fileGrant.path });
      this.lastAction = "upload_file";
    }

    const afterSignature = this.signature(window);
    const uiChanged = beforeSignature !== afterSignature;
    if (!uiChanged) this.noProgress += 1;
    else this.noProgress = 0;
    if (this.noProgress > 3) {
      this.emitSession("failed", null);
      throw { code: "NO_PROGRESS", message: "连续多次操作后界面没有变化" };
    }

    // 自动重新观察（observe → action → verify）
    const nextObservation = await this.observe({ sessionId: input.sessionId });
    const nextRecord = this.observations.get(nextObservation.observationId)!;
    let verification: { passed: boolean; checks: Array<{ check: string; passed: boolean; detail?: string }> } | undefined;
    if (input.expect && Object.keys(input.expect).length > 0) {
      const { evaluateActionExpectation } = await import("@/src/main/computer/verify");
      verification = evaluateActionExpectation({
        expectation: input.expect as never,
        newWindowTitle: nextObservation.windowTitle,
        newAppName: nextObservation.appName,
        newElements: nextObservation.elements,
        disappearedNativeRef:
          input.expect.elementDisappears?.elementId !== undefined
            ? input.expect.elementDisappears.elementId
            : null,
        newNativeRefs: new Set(nextRecord.elements.keys()),
      });
      // V2.3：与 Main 一致的反思判定（连续 2 次验证失败）
      if (verification.passed) {
        this.verificationFailStreak = 0;
      } else {
        this.verificationFailStreak += 1;
        if (this.verificationFailStreak >= 2 && this.session) {
          this.session.reflectionRequired = true;
          this.emitSession(this.session.state, this.session.actionLabel);
        }
      }
    }
    const reflectionRequired = this.session?.reflectionRequired === true;
    // V2.6：轨迹记录（与 Main 相同：只记结构化事实）
    this.trajectory.push({
      index: this.trajectory.length,
      action: input.action as never,
      targetLabel: element ? `${element.role}「${element.name}」` : "",
      risk: "normal",
      verificationPassed: verification ? verification.passed : null,
      at: Date.now(),
    });
    return {
      actionResult: {
        action: input.action as never,
        method: (input.action === "type" ? "uia-setvalue" : input.action === "key" ? "sendinput-key" : "uia-invoke") as never,
        durationMs: 50,
      },
      observation: nextObservation,
      newObservationId: nextObservation.observationId,
      changedWindow: false,
      uiChanged,
      ...(verification ? { verification } : {}),
      ...(reflectionRequired
        ? {
            reflectionRequired: true,
            reflectionHint:
              "上一步未达到预期或界面无变化：请重新 observe_desktop（必要时用 find_desktop_element 重新定位），并用 desktop_session 更新计划后再继续；不要重复同一动作。",
          }
        : {}),
    };
  });

  cancelActions = vi.fn(async (input: { sessionId: string }) => {    this.emitSession("cancelled", null);
    return { ok: true, cancelled: 1 };
  });

  activateWindow = vi.fn(async (input: { windowId: string; sessionId?: string }) => {
    this.log.push({ tool: "activateWindow", input });
    const window = this.windows.find((w) => w.windowId === input.windowId);
    if (!window) throw { code: "STALE_OBSERVATION", message: "目标窗口已不存在" };
    this.activeWindowId = window.windowId;
    window.minimized = false;
    this.ensureSession(input.sessionId ?? "cs-fake");
    this.session!.actions += 1;
    this.emitSession("idle", null);
    return { windowId: window.windowId, appName: window.appName, windowTitle: window.title, activated: true };
  });

  openApplication = vi.fn(async (input: { app: string; sessionId?: string }) => {
    this.log.push({ tool: "openApplication", input });
    const allowed = new Set(["chrome", "word", "wechat", "notepad", "explorer", "terminal"]);
    const appId = input.app.toLowerCase();
    if (!allowed.has(appId)) {
      throw { code: "APP_NOT_FOUND", message: "应用不在允许列表中" };
    }
    this.launchedApps.push(appId);
    const window = this.windows.find((w) => w.appName.toLowerCase().includes(appId));
    this.ensureSession(input.sessionId ?? "cs-fake");
    this.session!.actions += 1;
    if (window) this.activeWindowId = window.windowId;
    return {
      appId,
      label: appId,
      launched: true,
      ...(window ? { windowId: window.windowId } : {}),
      elapsedMs: 10,
    };
  });

  getSessionStatus = vi.fn(async (input: { sessionId: string }) => {
    this.ensureSession(input.sessionId);
    return this.session!;
  });

  pauseSession = vi.fn(async (input: { sessionId: string }) => {
    this.ensureSession(input.sessionId);
    this.emitSession("paused", null);
    return this.session!;
  });

  resumeSession = vi.fn(async (input: { sessionId: string }) => {
    this.ensureSession(input.sessionId);
    this.emitSession("idle", null);
    return this.session!;
  });

  completeSession = vi.fn(async (input: { sessionId: string }) => {
    this.ensureSession(input.sessionId);
    this.emitSession("completed", null);
    return this.session!;
  });

  setSessionState = vi.fn(async (input: { sessionId: string; state: "approval-required" | "waiting" | "idle" }) => {
    this.ensureSession(input.sessionId);
    this.emitSession(input.state, null);
    return this.session!;
  });

  /** V2.3：计划 / 目标 / 步骤（与 Main 语义一致：update_plan 消费 reflectionRequired） */
  updateSessionPlan = vi.fn(
    async (input: {
      sessionId: string;
      goal?: string;
      plan?: string[];
      stepIndex?: number;
      completeStep?: boolean;
    }) => {
      this.ensureSession(input.sessionId);
      const session = this.session!;
      if (input.goal !== undefined) session.goal = input.goal.slice(0, 120);
      if (input.plan !== undefined) {
        session.plan = input.plan.slice(0, 8).map((step) => step.slice(0, 80));
        session.stepIndex = Math.max(0, Math.min(session.stepIndex, Math.max(0, session.plan.length - 1)));
        session.reflectionRequired = false;
        this.verificationFailStreak = 0;
      }
      if (input.stepIndex !== undefined) {
        session.stepIndex = Math.max(0, Math.min(input.stepIndex, Math.max(0, session.plan.length - 1)));
      }
      if (input.completeStep) {
        session.stepIndex = Math.min(session.stepIndex + 1, Math.max(0, session.plan.length - 1));
        session.reflectionRequired = false;
      }
      this.emitSession(session.state, session.actionLabel);
      return session;
    }
  );

  /** V2.6：成功轨迹 → Skill 草稿（与 Main 同一纯函数实现） */
  buildSkillDraft = vi.fn(async (input: { sessionId: string }) => {
    this.ensureSession(input.sessionId);
    if (this.trajectory.length < MIN_TRAJECTORY_STEPS_FOR_SKILL) {
      throw { code: "INVALID_OPERATION", message: "轨迹步骤太少" };
    }
    const window = this.getActiveWindow();
    const profile = resolveDesktopAppProfile({
      appName: window?.appName ?? "",
      windowTitle: window?.title ?? "",
    });
    const draft = buildDesktopSkillDraft(
      {
        appName: window?.appName ?? null,
        appLabel: profile?.label ?? null,
        goal: this.session!.goal,
        steps: [...this.trajectory],
        result: this.session!.state === "completed" ? "completed" : "in-progress",
        startedAt: this.session!.createdAt,
      },
      input.sessionId
    );
    return { draft, steps: this.trajectory.length };
  });

  subscribeSession = (listener: (event: ClassFlowDesktopComputerSessionEvent) => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

/** 安装 fake bridge 到 window.classflowDesktop（renderer executor tests 用） */export function installFakeDesktopBridge(world: FakeDesktopWorld): { uninstall: () => void } {
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
  (window as unknown as { classflowDesktop?: unknown }).classflowDesktop = {
    version: 1,
    platform: "windows",
    filesystem: filesystemStub,
    computer: { version: 3, ...world },
  };
  return {
    uninstall: () => {
      delete (window as unknown as { classflowDesktop?: unknown }).classflowDesktop;
    },
  };
}
