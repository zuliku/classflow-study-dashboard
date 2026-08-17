/**
 * Task 7E Hotfix：Now Indicator 位置计算（纯函数）。
 * 核心：actual time ≠ visual timeline position。
 * - nowMinutes 永远是真实时间（绝不 clamp）
 * - 超过时间轴终点（21:00）后：视觉位置固定到底部安全位，胶囊文字仍显示真实 HH:mm
 * - 早于时间轴起点（08:00）前：对称固定到顶部安全位（防止早晨打开页面 top<0 溢出）
 */

export const NOW_INDICATOR_SAFE_INSET_PX = 16;

export interface NowIndicatorPosition {
  /** CSS top 值（%）或安全位 calc */
  top: string;
  /** timeline = 正常时间比例；pinned = 固定在时间轴边界安全位 */
  position: "timeline" | "pinned";
}

export function getNowIndicatorPosition(input: {
  nowMinutes: number;
  dayStartMinutes: number;
  totalMinutes: number;
}): NowIndicatorPosition {
  const { nowMinutes, dayStartMinutes, totalMinutes } = input;
  const timelineEndMinutes = dayStartMinutes + totalMinutes;

  // 21:00 之后（21:01 起）：固定到底部安全位；21:00 本身仍属于正常时间轴
  if (nowMinutes > timelineEndMinutes) {
    return { top: `calc(100% - ${NOW_INDICATOR_SAFE_INSET_PX}px)`, position: "pinned" };
  }
  // 早于 08:00：对称固定到顶部安全位（避免胶囊一半在容器外）
  if (nowMinutes < dayStartMinutes) {
    return { top: `calc(0% + ${NOW_INDICATOR_SAFE_INSET_PX}px)`, position: "pinned" };
  }
  return {
    top: `${((nowMinutes - dayStartMinutes) / totalMinutes) * 100}%`,
    position: "timeline",
  };
}
