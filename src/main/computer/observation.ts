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
import type { DesktopComputerBridgeErrorCode } from "@/lib/desktop/types";

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
}

const OBSERVE_INPUT_KEYS = new Set(["target", "windowId", "includeScreenshot", "includeUiTree"]);

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

  return {
    target,
    ...(windowId ? { windowId } : {}),
    includeScreenshot: readBool(raw.includeScreenshot, true),
    includeUiTree: readBool(raw.includeUiTree, true),
  };
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
  /**
   * elementId → native UI element reference（runtime-only）。
   * 只存在于内存；随记录 TTL 一起删除；绝不序列化返回。
   */
  elementRefs: Map<string, string>;
}

export interface CreateObservationInput {
  target: "active-window" | "screen";
  windowId: string | null;
  windowTitle: string;
  appName: string;
  screenshotCapturedAt: string | null;
  elementRefs: Map<string, string>;
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

  clear(): void {
    this.records.clear();
  }
}
