/**
 * Kiro Sidecar Minimized Capsule Position（Capsule V1）：
 * - right / bottom 表示（吸附右下角语义）
 * - 固定尺寸 176×46，margin 24
 * - 纯函数，供 Shell/Capsule/Preferences/测试共用
 * - 四边至少保留 24px，不产生 NaN/negative
 */

export interface SidecarMinimizedPosition {
  right: number;
  bottom: number;
}

export const SIDECAR_MINIMIZED_MARGIN = 24;

export const SIDECAR_MINIMIZED_SIZE = {
  width: 176,
  height: 46,
} as const;

export const DEFAULT_SIDECAR_MINIMIZED_POSITION: SidecarMinimizedPosition = {
  right: SIDECAR_MINIMIZED_MARGIN,
  bottom: SIDECAR_MINIMIZED_MARGIN,
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

/** 持久化值 hydrate 归一（任意值 → 有限数值 + margin 下限） */
export function normalizeSidecarMinimizedPosition(value: unknown): SidecarMinimizedPosition {
  const v = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const right = typeof v.right === "number" && Number.isFinite(v.right) ? v.right : DEFAULT_SIDECAR_MINIMIZED_POSITION.right;
  const bottom = typeof v.bottom === "number" && Number.isFinite(v.bottom) ? v.bottom : DEFAULT_SIDECAR_MINIMIZED_POSITION.bottom;
  return {
    right: Math.max(SIDECAR_MINIMIZED_MARGIN, right),
    bottom: Math.max(SIDECAR_MINIMIZED_MARGIN, bottom),
  };
}

/** 位置 clamp：四边均保留 margin */
export function clampSidecarMinimizedPosition(
  position: SidecarMinimizedPosition,
  viewport: { width: number; height: number }
): SidecarMinimizedPosition {
  const margin = SIDECAR_MINIMIZED_MARGIN;
  const { width, height } = SIDECAR_MINIMIZED_SIZE;
  const maxRight = Math.max(margin, viewport.width - width - margin);
  const maxBottom = Math.max(margin, viewport.height - height - margin);
  return {
    right: clamp(Math.round(position.right), margin, maxRight),
    bottom: clamp(Math.round(position.bottom), margin, maxBottom),
  };
}

/** 确定性几何修正（viewport resize 后） */
export function clampSidecarMinimizedGeometry(
  position: SidecarMinimizedPosition,
  viewport: { width: number; height: number }
): SidecarMinimizedPosition {
  return clampSidecarMinimizedPosition(position, viewport);
}
