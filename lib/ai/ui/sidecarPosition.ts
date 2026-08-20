/**
 * Kiro Sidecar 位置逻辑（Move V1 + Desktop Capsule Polish）：top/right 表示 + clamp + position-aware resize。
 * 纯函数（无 DOM），供 Shell 与测试共用。
 * - 保存 top/right（与既有 top-6/right-6 + left-resize 保持 right edge 语义一致）
 * - clamp：左/右/底 ≥24px，顶 ≥40px（--titlebar-h 26 + 14 safe gap，桌面 md+ 统一几何原则）
 * - clampSidecarSizeAtPosition：面板被移动到靠近某边后，resize 上限按当前 position 收紧，
 *   避免把面板拉出 viewport（left resize 保持 right edge → 宽度受 right+margin 限制；
 *   bottom resize 保持 top edge → 高度受 top+margin 限制）
 */

import { SidecarSize } from "@/lib/ai/ui/sidecarSize";
import {
  SIDECAR_MIN_WIDTH,
  SIDECAR_MIN_HEIGHT,
  SIDECAR_VIEWPORT_MARGIN,
  SIDECAR_VIEWPORT_TOP_MARGIN,
} from "@/lib/ai/ui/sidecarSize";

export interface SidecarPosition {
  /** 距 viewport 顶部的距离（px） */
  top: number;
  /** 距 viewport 右侧的距离（px） */
  right: number;
}

export const SIDECAR_DEFAULT_POSITION: SidecarPosition = { top: 24, right: 24 };

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

/** 持久化值 hydrate 归一（localStorage 可能为任意值；无 viewport 时只做结构归一，top 仍以 24 为底，展示层 clamp 到 40） */
export function normalizeSidecarPosition(value: unknown): SidecarPosition {
  const v = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const top = typeof v.top === "number" && Number.isFinite(v.top) ? v.top : SIDECAR_DEFAULT_POSITION.top;
  const right =
    typeof v.right === "number" && Number.isFinite(v.right) ? v.right : SIDECAR_DEFAULT_POSITION.right;
  return { top: Math.max(SIDECAR_VIEWPORT_MARGIN, top), right: Math.max(SIDECAR_VIEWPORT_MARGIN, right) };
}

/** 位置 clamp：左/右/底 ≥24px；顶 ≥40px（TitleBar safe area，viewport resize 时只作 presentation clamp） */
export function clampSidecarPosition(
  position: SidecarPosition,
  size: SidecarSize,
  viewport: { width: number; height: number }
): SidecarPosition {
  const margin = SIDECAR_VIEWPORT_MARGIN;
  const topMargin = SIDECAR_VIEWPORT_TOP_MARGIN;
  const maxRight = Math.max(margin, viewport.width - size.width - margin);
  const maxTop = Math.max(topMargin, viewport.height - size.height - margin);
  return {
    top: clamp(Math.round(position.top), topMargin, maxTop),
    right: clamp(Math.round(position.right), margin, maxRight),
  };
}

/**
 * position-aware size clamp：
 * - left resize 保持 right edge → maxWidth = viewport.width - position.right - margin
 * - bottom resize 保持 top edge → maxHeight = viewport.height - position.top - margin
 * - min 约束继续满足（max 不会低于 min，避免窗口过小时尺寸不可用）
 */
export function clampSidecarSizeAtPosition(
  size: SidecarSize,
  position: SidecarPosition,
  viewport: { width: number; height: number }
): SidecarSize {
  const margin = SIDECAR_VIEWPORT_MARGIN;
  const maxWidth = Math.max(SIDECAR_MIN_WIDTH, viewport.width - position.right - margin);
  const maxHeight = Math.max(SIDECAR_MIN_HEIGHT, viewport.height - position.top - margin);
  return {
    width: clamp(Math.round(size.width), SIDECAR_MIN_WIDTH, maxWidth),
    height: clamp(Math.round(size.height), SIDECAR_MIN_HEIGHT, maxHeight),
  };
}

/**
 * 确定性几何修正（viewport resize 后使用；避免 size/position 双 effect ping-pong）：
 * 1. 先按当前位置 clamp size（position 决定 resize 上限）
 * 2. 再按最终 size clamp position（位置是否有效依赖最终宽高）
 */
export function clampSidecarGeometry(
  size: SidecarSize,
  position: SidecarPosition,
  viewport: { width: number; height: number }
): { size: SidecarSize; position: SidecarPosition } {
  const clampedSize = clampSidecarSizeAtPosition(size, position, viewport);
  const clampedPosition = clampSidecarPosition(position, clampedSize, viewport);
  return { size: clampedSize, position: clampedPosition };
}
