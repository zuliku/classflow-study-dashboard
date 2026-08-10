/**
 * Context Menu 定位纯函数（Part A 修复）：
 * clientX/clientY 为 Viewport 坐标，菜单使用 position: fixed，二者坐标系一致。
 * 默认菜单左上角贴近鼠标右下方（offset 6px）；右侧空间不足 → 向左展开；
 * 底部空间不足 → 向上展开；最后 clamp 到 viewport 安全边距（8px）。
 * 不依赖 magic 固定高度：menuWidth/menuHeight 为渲染后真实尺寸。
 */

export interface ContextMenuPositionInput {
  /** 鼠标右键锚点（Viewport 坐标） */
  anchorX: number;
  anchorY: number;
  /** 渲染后真实菜单尺寸（非假定值） */
  menuWidth: number;
  menuHeight: number;
  viewportWidth?: number;
  viewportHeight?: number;
  /** viewport 安全边距（默认 8） */
  padding?: number;
  /** 锚点偏移（默认 6） */
  offset?: number;
}

export function computeContextMenuPosition(input: ContextMenuPositionInput): { x: number; y: number } {
  const {
    anchorX,
    anchorY,
    menuWidth,
    menuHeight,
    viewportWidth = window.innerWidth,
    viewportHeight = window.innerHeight,
    padding = 8,
    offset = 6,
  } = input;

  // 默认：菜单左上角位于鼠标右下方
  let x = anchorX + offset;
  let y = anchorY + offset;

  // 右侧不足 → 向左展开（菜单右缘贴鼠标左侧）
  if (x + menuWidth > viewportWidth - padding) {
    x = anchorX - menuWidth - offset;
  }
  // 底部不足 → 向上展开（菜单底缘贴鼠标上方）
  if (y + menuHeight > viewportHeight - padding) {
    y = anchorY - menuHeight - offset;
  }

  // 最终 clamp 到安全边距（菜单大于 viewport 时保底 8px）
  x = Math.min(Math.max(x, padding), Math.max(padding, viewportWidth - menuWidth - padding));
  y = Math.min(Math.max(y, padding), Math.max(padding, viewportHeight - menuHeight - padding));

  return { x, y };
}
