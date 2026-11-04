/**
 * 行内浮层水平定位（Kiro ContextBar +N Popover）。
 *
 * 弹层不是 Portal，absolute 定位于按钮 wrapper 内；若固定 `left-0`，
 * 靠近 Sidecar 右缘时会被 Shell 的 `overflow-hidden` 裁掉。
 * 这里以「锚点 + 可视边界」计算一个 clamp 后的 left，保证完整可见：
 * - 默认左缘对齐按钮左缘；
 * - 右侧不足时向左收，但不越过边界安全边距；
 * - 返回 transformOriginX，让 0.99 scale 的缩放原点靠近锚点。
 *
 * 纯函数（不读 DOM），由组件传入真实 rect。
 */

export interface AnchoredPopoverInput {
  /** 触发按钮的 Viewport rect */
  anchorLeft: number;
  anchorRight: number;
  /** 可视边界（ContextBar 内容盒）的 Viewport rect */
  boundaryLeft: number;
  boundaryRight: number;
  /** 弹层宽度（px） */
  width: number;
  /** 与边界保留的安全间距（默认 4） */
  padding?: number;
}

export interface AnchoredPopoverResult {
  /** Viewport 坐标系下弹层左缘 */
  left: number;
  /** 缩放动画原点：锚点位于弹层右半 → right，否则 left */
  transformOriginX: "left" | "right";
}

export function computeAnchoredPopoverX(input: AnchoredPopoverInput): AnchoredPopoverResult {
  const { anchorLeft, anchorRight, boundaryLeft, boundaryRight, width, padding = 4 } = input;
  const minLeft = boundaryLeft + padding;
  // 边界比弹层还窄时（极端窄宿主）至少保证左缘不越界；右缘交由 max-width 兜底。
  const maxLeft = Math.max(minLeft, boundaryRight - width - padding);
  const left = Math.round(Math.min(Math.max(anchorLeft, minLeft), maxLeft));
  const anchorCenter = (anchorLeft + anchorRight) / 2;
  const transformOriginX = anchorCenter >= left + width / 2 ? "right" : "left";
  return { left, transformOriginX };
}
