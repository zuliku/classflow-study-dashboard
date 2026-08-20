/**
 * Kiro Sidecar 尺寸逻辑（UX V2）：默认值 / 最小约束 / viewport clamp / 拖拽增量。
 * 纯函数（无 DOM），供 Shell 与测试共用。
 */

export interface SidecarSize {
  width: number;
  height: number;
}

export const SIDECAR_DEFAULT_SIZE: SidecarSize = { width: 620, height: 760 };
export const SIDECAR_MIN_WIDTH = 420;
export const SIDECAR_MIN_HEIGHT = 560;
/** 面板与 viewport 四边保留的安全边距（左/右/底） */
export const SIDECAR_VIEWPORT_MARGIN = 24;
/** 桌面 TitleBar 安全顶部边距：--titlebar-h(26px) + 12~16px → 40px（统一 Capsule/Full Sidecar 几何原则） */
export const SIDECAR_VIEWPORT_TOP_MARGIN = 40;

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

/**
 * 尺寸归一：min 下限 + viewport 上限（maxWidth/maxHeight 不小于 min，
 * 窗口过小时收缩到可显示范围而非溢出）。
 */
export function clampSidecarSize(size: SidecarSize, viewport: { width: number; height: number }): SidecarSize {
  const maxWidth = Math.max(SIDECAR_MIN_WIDTH, viewport.width - SIDECAR_VIEWPORT_MARGIN * 2);
  const maxHeight = Math.max(SIDECAR_MIN_HEIGHT, viewport.height - SIDECAR_VIEWPORT_MARGIN * 2);
  return {
    width: clamp(Math.round(size.width), SIDECAR_MIN_WIDTH, maxWidth),
    height: clamp(Math.round(size.height), SIDECAR_MIN_HEIGHT, maxHeight),
  };
}

/**
 * 拖拽增量 resize：
 * - 左边缘拖宽：deltaWidth = -dx（向左拉 → 更宽）
 * - 底边拖高：deltaHeight = dy
 * - 左下角 handle：两者同时
 */
export function resizeSidecarSize(
  current: SidecarSize,
  delta: { deltaWidth: number; deltaHeight: number },
  viewport: { width: number; height: number }
): SidecarSize {
  return clampSidecarSize(
    {
      width: current.width + delta.deltaWidth,
      height: current.height + delta.deltaHeight,
    },
    viewport
  );
}

/** 持久化值 hydrate 归一（localStorage 可能为任意值） */
export function normalizeSidecarSize(value: unknown): SidecarSize {
  const v = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const width = typeof v.width === "number" && Number.isFinite(v.width) ? v.width : SIDECAR_DEFAULT_SIZE.width;
  const height = typeof v.height === "number" && Number.isFinite(v.height) ? v.height : SIDECAR_DEFAULT_SIZE.height;
  // 无 viewport 时只做结构归一（clamp 由 Shell 在浏览器内执行）
  return { width: Math.max(SIDECAR_MIN_WIDTH, width), height: Math.max(SIDECAR_MIN_HEIGHT, height) };
}
