/**
 * Overlay 层级管理：Drawer(z40) < Modal(z50) < Confirm(z60) < Toast(z70)。
 * 按挂载顺序维护栈，Esc 只关闭最上层 Overlay，避免一次关掉 Drawer + Modal。
 */

interface OverlayEntry {
  id: string;
  z: number;
}

let stack: OverlayEntry[] = [];

/** 挂载时注册（同一 id 只保留一次，后注册的视为更上层） */
export function pushOverlay(id: string, z: number): void {
  stack = [...stack.filter((e) => e.id !== id), { id, z }];
}

/** 卸载时移除 */
export function popOverlay(id: string): void {
  stack = stack.filter((e) => e.id !== id);
}

/** 当前是否为最上层 Overlay（只有最上层响应 Esc） */
export function isTopmostOverlay(id: string): boolean {
  const top = stack[stack.length - 1];
  return !!top && top.id === id;
}

/** 当前最上层 z（无 overlay 时为 0）。Portal 浮层据此保证始终压在其宿主之上。 */
export function getTopOverlayZ(): number {
  return stack.length > 0 ? stack[stack.length - 1].z : 0;
}

/**
 * 排除自身 overlay 后的最上层 z。
 * Popover 自身以 z40 入栈；若宿主是 Dialog z50，测量时必须仍读到 50，
 * 否则后续 resize 重测会把 portal 菜单降回 40、掉到 Dialog 背后。
 */
export function getTopOverlayZExcept(id?: string): number {
  if (!id) return getTopOverlayZ();
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].id !== id) return stack[i].z;
  }
  return 0;
}

/** 是否存在任何已挂载的 Overlay（用于单键快捷键的阻断判断，如 N） */
export function hasAnyOverlay(): boolean {
  return stack.length > 0;
}

/** 测试用 */
export function clearOverlayStack(): void {
  stack = [];
}
