/**
 * Computer Use Phase 1 — Observation Store + IPC 输入归一化（纯逻辑，无 electron 依赖）。
 *
 * 生命周期契约：
 * - observation 只存在 runtime memory，短 TTL 后删除（默认 120s），绝不持久化到磁盘
 * - 每次 observe_desktop 生成 obs-<uuid>
 * - 内部保存：window identity（opaque windowId）、UI tree revision、screenshot timestamp、
 *   elementId → native UI element mapping
 * - elementId → native 映射绝不返回 renderer / model
 */
import { randomUUID } from "node:crypto";
import { DESKTOP_WINDOW_ID_PATTERN } from "./windows";
import type { DesktopComputerBridgeErrorCode, DesktopGuiActionType } from "@/lib/desktop/types";

export const DESKTOP_OBSERVATION_TTL_MS = 120_000;
export const DESKTOP_OBSERVATION_MAX_RECORDS = 50;
export const DESKTOP_OBSERVATION_ID_PATTERN = /^obs-[A-Za-z0-9-]{8,64}$/;

/** 结构化 Bridge 错误（IPC 层编码为 { code, message }） */
export class DesktopComputerIpcError extends Error {
  readonly code: DesktopComputerBridgeErrorCode;
  constructor(code: DesktopComputerBridgeErrorCode, message?: string) {
    super(message ?? code);
    this.name = "DesktopComputerIpcError";
    this.code = code;
  }
}

export interface NormalizedObserveInput {
  target: "active-window" | "screen";
  windowId?: string;
  includeScreenshot: boolean;
  includeUiTree: boolean;
  sessionId?: string;
}

const OBSERVE_INPUT_KEYS = new Set(["target", "windowId", "includeScreenshot", "includeUiTree", "sessionId"]);

/** Desktop Control session id（renderer 生成；opaque） */
export const DESKTOP_SESSION_ID_PATTERN = /^cs-[A-Za-z0-9-]{8,64}$/;

export function isValidDesktopSessionId(value: unknown): value is string {
  return typeof value === "string" && DESKTOP_SESSION_ID_PATTERN.test(value);
}

/**
 * Malformed IPC 输入归一化（fail closed）：
 * - 非 object → INVALID_OPERATION
 * - 未知字段 → INVALID_OPERATION（strict）
 * - target / windowId / include* 类型不合法 → INVALID_OPERATION
 * - windowId 只能是 observe 返回的 opaque 逻辑 id（win-…）
 */
export function normalizeObserveInput(input: unknown): NormalizedObserveInput {
  if (input === undefined || input === null) {
    return { target: "active-window", includeScreenshot: true, includeUiTree: true };
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new DesktopComputerIpcError("INVALID_OPERATION", "observe 输入必须是对象");
  }
  const raw = input as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!OBSERVE_INPUT_KEYS.has(key)) {
      throw new DesktopComputerIpcError("INVALID_OPERATION", `不支持的字段：${key}`);
    }
  }

  let target: "active-window" | "screen";
  if (raw.target === undefined) target = "active-window";
  else if (raw.target === "active-window" || raw.target === "screen") target = raw.target;
  else throw new DesktopComputerIpcError("INVALID_OPERATION", "target 只能是 active-window 或 screen");

  let windowId: string | undefined;
  if (raw.windowId !== undefined) {
    if (typeof raw.windowId !== "string" || !DESKTOP_WINDOW_ID_PATTERN.test(raw.windowId)) {
      throw new DesktopComputerIpcError("INVALID_OPERATION", "windowId 不是合法的逻辑窗口 id");
    }
    if (target === "screen") {
      throw new DesktopComputerIpcError("INVALID_OPERATION", "windowId 不能与 target=screen 同时使用");
    }
    windowId = raw.windowId;
  }

  const readBool = (value: unknown, fallback: boolean): boolean => {
    if (value === undefined) return fallback;
    if (typeof value !== "boolean") {
      throw new DesktopComputerIpcError("INVALID_OPERATION", "includeScreenshot / includeUiTree 必须是 boolean");
    }
    return value;
  };

  let sessionId: string | undefined;
  if (raw.sessionId !== undefined) {
    if (!isValidDesktopSessionId(raw.sessionId)) {
      throw new DesktopComputerIpcError("INVALID_OPERATION", "sessionId 不是合法的 Control session id");
    }
    sessionId = raw.sessionId;
  }

  return {
    target,
    ...(windowId ? { windowId } : {}),
    includeScreenshot: readBool(raw.includeScreenshot, true),
    includeUiTree: readBool(raw.includeUiTree, true),
    ...(sessionId ? { sessionId } : {}),
  };
}

export interface NormalizedActionTarget {
  elementId?: string;
  normalized?: { x: number; y: number };
}

export interface NormalizedActionInput {
  action: DesktopGuiActionType;
  observationId?: string;
  target?: NormalizedActionTarget;
  text?: string;
  key?: string;
  scroll?: number;
  wait?: number;
  sessionId?: string;
}

const ACTION_INPUT_KEYS = new Set([
  "action",
  "observationId",
  "target",
  "text",
  "key",
  "scroll",
  "wait",
  "sessionId",
]);
const ACTION_TARGET_KEYS = new Set(["elementId", "normalized"]);
const ACTION_TYPES: readonly DesktopGuiActionType[] = [
  "click",
  "double_click",
  "focus",
  "type",
  "key",
  "scroll",
  "wait",
];

function failInvalid(message: string): never {
  throw new DesktopComputerIpcError("INVALID_OPERATION", message);
}

/**
 * desktop_action malformed IPC 输入归一化（fail closed）：
 * - strict 字段白名单；action 必须枚举内
 * - target 二选一（elementId / normalized 0~1）；坐标禁止物理像素
 * - observationId 规则：除 wait 外全部必填（观察强绑定）
 * - 动作专属字段（text/key/scroll/wait）必须匹配 action，不允许跨动作夹带
 */
export function normalizeActionInput(input: unknown): NormalizedActionInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    failInvalid("desktop_action 输入必须是对象");
  }
  const raw = input as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!ACTION_INPUT_KEYS.has(key)) failInvalid(`不支持的字段：${key}`);
  }
  if (typeof raw.action !== "string" || !ACTION_TYPES.includes(raw.action as DesktopGuiActionType)) {
    failInvalid("action 不在允许列表内");
  }
  const action = raw.action as DesktopGuiActionType;

  let sessionId: string | undefined;
  if (raw.sessionId !== undefined) {
    if (!isValidDesktopSessionId(raw.sessionId)) failInvalid("sessionId 不是合法的 Control session id");
    sessionId = raw.sessionId;
  }

  let observationId: string | undefined;
  if (raw.observationId !== undefined) {
    if (
      typeof raw.observationId !== "string" ||
      !DESKTOP_OBSERVATION_ID_PATTERN.test(raw.observationId)
    ) {
      failInvalid("observationId 不是合法的观察 id");
    }
    observationId = raw.observationId;
  }
  if (action !== "wait" && !observationId) {
    failInvalid("该动作必须先 observe_desktop 并提供 observationId");
  }

  let target: NormalizedActionTarget | undefined;
  if (raw.target !== undefined) {
    if (!raw.target || typeof raw.target !== "object" || Array.isArray(raw.target)) {
      failInvalid("target 必须是对象");
    }
    const rawTarget = raw.target as Record<string, unknown>;
    for (const key of Object.keys(rawTarget)) {
      if (!ACTION_TARGET_KEYS.has(key)) failInvalid(`不支持的目标字段：${key}`);
    }
    const hasElementId = rawTarget.elementId !== undefined;
    const hasNormalized = rawTarget.normalized !== undefined;
    if (hasElementId === hasNormalized) {
      failInvalid("target 必须且只能提供 elementId 或 normalized 之一");
    }
    if (hasElementId) {
      if (typeof rawTarget.elementId !== "string" || !/^el-\d{1,4}$/.test(rawTarget.elementId)) {
        failInvalid("elementId 不是合法的观察元素 id");
      }
      target = { elementId: rawTarget.elementId };
    } else {
      const normalized = rawTarget.normalized;
      if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
        failInvalid("normalized 必须是 { x, y }");
      }
      const n = normalized as Record<string, unknown>;
      for (const key of Object.keys(n)) {
        if (key !== "x" && key !== "y") failInvalid(`不支持的坐标字段：${key}`);
      }
      const x = typeof n.x === "number" ? n.x : NaN;
      const y = typeof n.y === "number" ? n.y : NaN;
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
        failInvalid("normalized 坐标必须在 0~1 之间（禁止物理像素）");
      }
      target = { normalized: { x, y } };
    }
  }

  // 动作专属字段校验（不允许跨动作夹带）
  const requireField = <T>(value: unknown, name: string, predicate: (v: unknown) => boolean): T => {
    if (value === undefined || !predicate(value)) failInvalid(`${name} 不合法`);
    return value as T;
  };
  if (action === "type") {
    requireField<string>(raw.text, "text", (v) => typeof v === "string" && v.length > 0 && v.length <= 2000);
    if (raw.key !== undefined || raw.scroll !== undefined || raw.wait !== undefined) {
      failInvalid("type 动作不允许携带 key / scroll / wait");
    }
  } else if (action === "key") {
    requireField<string>(raw.key, "key", (v) => typeof v === "string" && v.length > 0 && v.length <= 32);
    if (raw.text !== undefined || raw.scroll !== undefined || raw.wait !== undefined) {
      failInvalid("key 动作不允许携带 text / scroll / wait");
    }
  } else if (action === "scroll") {
    requireField<number>(
      raw.scroll,
      "scroll",
      (v) => typeof v === "number" && Number.isInteger(v) && v >= -10 && v <= 10 && v !== 0
    );
    if (raw.text !== undefined || raw.key !== undefined || raw.wait !== undefined) {
      failInvalid("scroll 动作不允许携带 text / key / wait");
    }
  } else if (action === "wait") {
    requireField<number>(
      raw.wait,
      "wait",
      (v) => typeof v === "number" && Number.isInteger(v) && v >= 100 && v <= 5000
    );
    if (raw.text !== undefined || raw.key !== undefined || raw.scroll !== undefined || raw.target !== undefined) {
      failInvalid("wait 动作不允许携带 text / key / scroll / target");
    }
  } else {
    // click / double_click / focus
    if (!target) failInvalid("该动作必须提供 target（elementId 或 normalized 坐标）");
    if (target.normalized !== undefined && action === "focus") {
      failInvalid("focus 只能使用 elementId");
    }
    if (raw.text !== undefined || raw.key !== undefined || raw.scroll !== undefined || raw.wait !== undefined) {
      failInvalid(`${action} 动作不允许携带 text / key / scroll / wait`);
    }
  }

  return {
    action,
    ...(observationId ? { observationId } : {}),
    ...(target ? { target } : {}),
    ...(typeof raw.text === "string" ? { text: raw.text } : {}),
    ...(typeof raw.key === "string" ? { key: raw.key } : {}),
    ...(typeof raw.scroll === "number" ? { scroll: raw.scroll } : {}),
    ...(typeof raw.wait === "number" ? { wait: raw.wait } : {}),
    ...(sessionId ? { sessionId } : {}),
  };
}

/* ---------------- Computer Use Phase 3：Session / 窗口 / 应用 输入归一化 ---------------- */

const SESSION_ONLY_KEYS = new Set(["sessionId"]);

/** { sessionId } 严格校验（必需） */
export function normalizeSessionOnlyInput(input: unknown): { sessionId: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new DesktopComputerIpcError("INVALID_OPERATION", "输入必须是对象");
  }
  const raw = input as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!SESSION_ONLY_KEYS.has(key)) {
      throw new DesktopComputerIpcError("INVALID_OPERATION", `不支持的字段：${key}`);
    }
  }
  if (!isValidDesktopSessionId(raw.sessionId)) {
    throw new DesktopComputerIpcError("INVALID_OPERATION", "sessionId 不合法");
  }
  return { sessionId: raw.sessionId };
}

/** { sessionId? } 严格校验 */
export function normalizeOptionalSessionInput(input: unknown): { sessionId?: string } {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new DesktopComputerIpcError("INVALID_OPERATION", "输入必须是对象");
  }
  const raw = input as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!SESSION_ONLY_KEYS.has(key)) {
      throw new DesktopComputerIpcError("INVALID_OPERATION", `不支持的字段：${key}`);
    }
  }
  if (raw.sessionId === undefined) return {};
  if (!isValidDesktopSessionId(raw.sessionId)) {
    throw new DesktopComputerIpcError("INVALID_OPERATION", "sessionId 不合法");
  }
  return { sessionId: raw.sessionId };
}

/** activate_window 输入（opaque windowId + 可选 sessionId） */
export function normalizeActivateWindowInput(input: unknown): { windowId: string; sessionId?: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new DesktopComputerIpcError("INVALID_OPERATION", "activate_window 输入必须是对象");
  }
  const raw = input as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (key !== "windowId" && key !== "sessionId") {
      throw new DesktopComputerIpcError("INVALID_OPERATION", `不支持的字段：${key}`);
    }
  }
  if (typeof raw.windowId !== "string" || !DESKTOP_WINDOW_ID_PATTERN.test(raw.windowId)) {
    throw new DesktopComputerIpcError("INVALID_OPERATION", "windowId 不是合法的逻辑窗口 id");
  }
  const session = normalizeOptionalSessionInput(
    raw.sessionId === undefined ? {} : { sessionId: raw.sessionId }
  );
  return { windowId: raw.windowId, ...(session.sessionId ? { sessionId: session.sessionId } : {}) };
}

/** open_application 输入（logical app id + 可选 sessionId；路径样式在 apps 层拒绝） */
export function normalizeOpenApplicationInput(input: unknown): { app: string; sessionId?: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new DesktopComputerIpcError("INVALID_OPERATION", "open_application 输入必须是对象");
  }
  const raw = input as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (key !== "app" && key !== "sessionId") {
      throw new DesktopComputerIpcError("INVALID_OPERATION", `不支持的字段：${key}`);
    }
  }
  if (typeof raw.app !== "string" || raw.app.trim().length === 0 || raw.app.length > 64) {
    throw new DesktopComputerIpcError("INVALID_OPERATION", "app 必须是逻辑应用名（例如 chrome / word / wechat）");
  }
  if (raw.app.includes("\\") || raw.app.includes("/") || /^[A-Za-z]:/.test(raw.app)) {
    throw new DesktopComputerIpcError("INVALID_OPERATION", "不接受 exe / 文件路径，只能使用逻辑应用名");
  }
  const session = normalizeOptionalSessionInput(
    raw.sessionId === undefined ? {} : { sessionId: raw.sessionId }
  );
  return { app: raw.app.trim(), ...(session.sessionId ? { sessionId: session.sessionId } : {}) };
}

/** setSessionState 输入（UI 状态：approval-required / waiting / idle） */
export function normalizeSessionStateInput(input: unknown): {
  sessionId: string;
  state: "approval-required" | "waiting" | "idle";
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new DesktopComputerIpcError("INVALID_OPERATION", "输入必须是对象");
  }
  const raw = input as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (key !== "sessionId" && key !== "state") {
      throw new DesktopComputerIpcError("INVALID_OPERATION", `不支持的字段：${key}`);
    }
  }
  if (!isValidDesktopSessionId(raw.sessionId)) {
    throw new DesktopComputerIpcError("INVALID_OPERATION", "sessionId 不合法");
  }
  if (raw.state !== "approval-required" && raw.state !== "waiting" && raw.state !== "idle") {
    throw new DesktopComputerIpcError("INVALID_OPERATION", "state 不合法");
  }
  return { sessionId: raw.sessionId, state: raw.state };
}

/** 观察到的单个 UI 元素（runtime-only；供 action 强绑定校验） */export interface ObservedElementRef {
  /** UIA RuntimeId 字符串；绝不外传 */
  nativeRef: string;
  role: string;
  name: string;
  isPassword: boolean;
  bounds: { x: number; y: number; width: number; height: number };
  /** 观察时的窗口 opaque id（验证窗口未切换） */
  windowId: string | null;
}

export interface DesktopObservationRecord {
  id: string;
  createdAt: number;
  target: "active-window" | "screen";
  windowId: string | null;
  windowTitle: string;
  appName: string;
  revision: number;
  screenshotCapturedAt: string | null;
  sessionId: string | null;
  /** 产生该 observation 的原始请求（action 后自动重新观察需要同样的目标参数） */
  request: NormalizedObserveInput;
  /**
   * 坐标回退基准（runtime-only）：window 观察 = 窗口 bounds；screen 观察 = 主屏 bounds。
   * 归一化坐标永远相对该基准，禁止物理像素。
   */
  coordinateBounds: { x: number; y: number; width: number; height: number } | null;
  /** UI 元素指纹（changed UI evidence 比较用；runtime-only） */
  uiSignature: string;
  /**
   * elementId → native UI element reference（runtime-only）。
   * 只存在于内存；随记录 TTL 一起删除；绝不序列化返回。
   */
  elementRefs: Map<string, ObservedElementRef>;
}

export interface CreateObservationInput {
  target: "active-window" | "screen";
  windowId: string | null;
  windowTitle: string;
  appName: string;
  screenshotCapturedAt: string | null;
  sessionId: string | null;
  request: NormalizedObserveInput;
  coordinateBounds: { x: number; y: number; width: number; height: number } | null;
  uiSignature: string;
  elementRefs: Map<string, ObservedElementRef>;
}

/** UI 元素指纹（roles + names + bounds；不含 nativeRef / 输入内容） */
export function computeUiSignature(
  elements: { role: string; name: string; bounds: { x: number; y: number; width: number; height: number } }[]
): string {
  const flat = elements
    .map((e) => `${e.role}|${e.name}|${e.bounds.x},${e.bounds.y},${e.bounds.width},${e.bounds.height}`)
    .join(";");
  let hash = 0;
  for (let i = 0; i < flat.length; i++) hash = (hash * 31 + flat.charCodeAt(i)) >>> 0;
  return `${hash.toString(16)}:${elements.length}`;
}

/**
 * 短生命周期 Observation Store（runtime memory only）。
 * sweep 为惰性清理；IPC 注册层会额外启动定时 sweep（带 unref）。
 */
export class DesktopObservationStore {
  private records = new Map<string, DesktopObservationRecord>();
  private revisionCounter = 0;

  nextRevision(): number {
    this.revisionCounter += 1;
    return this.revisionCounter;
  }

  create(input: CreateObservationInput, now: number = Date.now()): DesktopObservationRecord {
    this.sweep(now);
    const record: DesktopObservationRecord = {
      id: `obs-${randomUUID()}`,
      createdAt: now,
      target: input.target,
      windowId: input.windowId,
      windowTitle: input.windowTitle,
      appName: input.appName,
      revision: this.nextRevision(),
      screenshotCapturedAt: input.screenshotCapturedAt,
      sessionId: input.sessionId,
      request: input.request,
      coordinateBounds: input.coordinateBounds,
      uiSignature: input.uiSignature,
      elementRefs: input.elementRefs,
    };
    this.records.set(record.id, record);
    // 容量上限：淘汰最旧记录（含 element 映射，绝不泄漏到 store 之外）
    while (this.records.size > DESKTOP_OBSERVATION_MAX_RECORDS) {
      const oldest = this.records.keys().next();
      if (oldest.done) break;
      this.records.delete(oldest.value);
    }
    return record;
  }

  /** 读取未过期记录；过期 → 删除并返回 null */
  get(id: string, now: number = Date.now()): DesktopObservationRecord | null {
    const record = this.records.get(id);
    if (!record) return null;
    if (now - record.createdAt > DESKTOP_OBSERVATION_TTL_MS) {
      this.records.delete(id);
      return null;
    }
    return record;
  }

  /** 清理过期记录；返回删除数量 */
  sweep(now: number = Date.now()): number {
    let removed = 0;
    for (const [id, record] of this.records) {
      if (now - record.createdAt > DESKTOP_OBSERVATION_TTL_MS) {
        this.records.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  size(): number {
    return this.records.size;
  }

  /**
   * Emergency Stop：删除该 session 的全部 observation（含 elementId → native 映射）。
   * 返回删除数量。
   */
  cancelSession(sessionId: string): number {
    let removed = 0;
    for (const [id, record] of this.records) {
      if (record.sessionId === sessionId) {
        this.records.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  clear(): void {
    this.records.clear();
  }
}

/**
 * Desktop Control session registry（Emergency Stop）：
 * - cancelSession 后该 session 永久 cancelled（本 Turn 内不再执行任何 GUI 动作）
 * - 容量有界（只保留最近 50 个 session 标记）
 */
export class DesktopActionSessionRegistry {
  private cancelled = new Map<string, number>();
  private static MAX_SESSIONS = 50;

  markCancelled(sessionId: string, now: number = Date.now()): void {
    this.cancelled.set(sessionId, now);
    while (this.cancelled.size > DesktopActionSessionRegistry.MAX_SESSIONS) {
      const oldest = this.cancelled.keys().next();
      if (oldest.done) break;
      this.cancelled.delete(oldest.value);
    }
  }

  isCancelled(sessionId: string): boolean {
    return this.cancelled.has(sessionId);
  }

  clear(): void {
    this.cancelled.clear();
  }
}
