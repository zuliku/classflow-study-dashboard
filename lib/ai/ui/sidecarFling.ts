/**
 * Kiro Sidecar Fling（Motion V3 P2 收尾）：松手惯性投射（纯函数，无 DOM）。
 *
 * 语义：
 * - 只做**单次投射**（one commit）：松手瞬间按松手前速度沿惯性方向多滑一段，
 *   经 clamp 落到合法位置后一次性持久化。不跑动画循环、不新增 timer，
 *   与 Shell 既有「commit 语义不变 + 同一 paint 周期落位」完全兼容。
 * - 慢速拖拽 / 点按 / 键盘 discrete 步进一律走原路径（无投射），
 *   现有手势测试行为保持不变。
 *
 * 守卫（缺一即不 fling）：
 * - 至少 FLING_MIN_SAMPLES（3）个 move 采样（一次果断甩动在 60Hz 下约 6+ 采样；
 *   点按/键盘 discrete 只有 1 个，现有同步手势测试最多 2 个——天然豁免）；
 * - 最后两采样间隔 dt >= FLING_MIN_DT_MS（8ms，同步派发事件 dt≈0ms 豁免）；
 * - 末速度 >= FLING_MIN_SPEED_PX_MS（0.9px/ms，约一次果断甩动）；
 * - 整段手势位移 >= FLING_MIN_DISTANCE_PX（24px，防抖动）；
 * - 投射距离封顶 FLING_MAX_PROJECTION_PX（200px），再经 clampSidecarPosition。
 */

import { clampSidecarPosition, type SidecarPosition } from "@/lib/ai/ui/sidecarPosition";
import type { SidecarSize } from "@/lib/ai/ui/sidecarSize";

export interface FlingSample {
  /** 相对 drag 起点的增量（与 MoveHandle onMove delta 同语义，px） */
  deltaX: number;
  deltaY: number;
  /** 采样时刻（performance.now()，ms） */
  t: number;
}

export interface FlingVelocity {
  /** 屏幕 px/ms（x 右正，y 下正） */
  vx: number;
  vy: number;
  speed: number;
}

/** 起甩最小采样数（pointermove 事件数；点按/键盘=1，存量同步测试≤2） */
export const FLING_MIN_SAMPLES = 3;
/** 最后两采样最小间隔：低于此视为同步/抖动，不算速度 */
export const FLING_MIN_DT_MS = 8;
/** 起甩最小末速度 */
export const FLING_MIN_SPEED_PX_MS = 0.9;
/** 起甩最小整段位移（防抖） */
export const FLING_MIN_DISTANCE_PX = 24;
/** 投射距离上限 */
export const FLING_MAX_PROJECTION_PX = 200;
/** 投射滑行窗口（速度 × 窗口 = 原始投射位移，再封顶） */
export const FLING_SLIDE_MS = 120;

/**
 * 由最后两采样计算末速度；不满足 dt/速度守卫返回 null（调用方走原路径）。
 */
export function computeFlingVelocity(prev: FlingSample, last: FlingSample): FlingVelocity | null {
  const dt = last.t - prev.t;
  if (!Number.isFinite(dt) || dt < FLING_MIN_DT_MS) return null;
  const vx = (last.deltaX - prev.deltaX) / dt;
  const vy = (last.deltaY - prev.deltaY) / dt;
  if (!Number.isFinite(vx) || !Number.isFinite(vy)) return null;
  const speed = Math.hypot(vx, vy);
  if (!(speed >= FLING_MIN_SPEED_PX_MS)) return null;
  return { vx, vy, speed };
}

/**
 * 整段手势位移（首采样 → 末采样）；单采样/空返回 0。
 */
export function gestureDistance(samples: readonly FlingSample[]): number {
  if (samples.length < 2) return 0;
  const first = samples[0];
  const last = samples[samples.length - 1];
  return Math.hypot(last.deltaX - first.deltaX, last.deltaY - first.deltaY);
}

/**
 * 沿速度方向投射并 clamp：
 * - 屏幕 dx → right 反向（right = right - dx），dy → top 同向；
 * - 位移 = v × SLIDE，封顶 MAX_PROJECTION，再经 clampSidecarPosition。
 */
export function projectFlingPosition(args: {
  /** 手指位置（已 clamp 的当前 draft position） */
  position: SidecarPosition;
  velocity: FlingVelocity;
  size: SidecarSize;
  viewport: { width: number; height: number };
}): SidecarPosition {
  const { position, velocity, size, viewport } = args;
  const rawDx = velocity.vx * FLING_SLIDE_MS;
  const rawDy = velocity.vy * FLING_SLIDE_MS;
  const len = Math.hypot(rawDx, rawDy);
  const scale = len > 0 ? Math.min(len, FLING_MAX_PROJECTION_PX) / len : 0;
  return clampSidecarPosition(
    {
      top: position.top + rawDy * scale,
      right: position.right - rawDx * scale,
    },
    size,
    viewport
  );
}
