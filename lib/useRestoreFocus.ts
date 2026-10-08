import { useEffect, useRef } from "react";
import { isVisibleElement } from "@/lib/focusVisibility";

/**
 * 打开 Overlay 时记录触发元素，关闭后把焦点还给它，
 * 避免关闭 Modal / Drawer 后焦点丢失到 body。
 *
 * opt-in restoreKey（Detail Panel 实体切换用）：
 * - open=true 且 restoreKey 变化（如详情从 Task A 切到 Task B）→ 在安全条件下把 opener
 *   更新为“最近一次导致实体切换的可聚焦 trigger”，关闭后焦点回到当前实体，而非旧实体。
 * - 不提供 restoreKey 的 consumer：行为与旧版完全一致（只在 open 变化时记录）。
 * 可见性走统一口径（lib/focusVisibility），与 useFocusTrap 同轨。
 */
function isFocusableTarget(el: HTMLElement | null): el is HTMLElement {
  if (!el || el === document.body) return false;
  if ((el as HTMLButtonElement).disabled) return false;
  if (!isVisibleElement(el)) return false;
  return typeof el.focus === "function";
}

export function useRestoreFocus(open: boolean, restoreKey?: string | number | null): void {
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      const el = document.activeElement as HTMLElement | null;
      // 只记录真正可聚焦的触发元素；陷阱内元素（restoreKey 翻转时）不覆盖 opener
      if (isFocusableTarget(el) && openerRef.current !== el) {
        const inTrap = el.closest('[role="dialog"],[data-focus-trap]');
        if (restoreKey === undefined || !inTrap) openerRef.current = el;
      }
    } else if (openerRef.current) {
      // 触发元素可能已卸载/禁用/隐藏（detached 节点 focus 会丢到 body）：复查后再还焦
      const opener = openerRef.current;
      openerRef.current = null;
      if (document.contains(opener) && isFocusableTarget(opener)) {
        opener.focus();
      }
    }
  }, [open, restoreKey]);
}
