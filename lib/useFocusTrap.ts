import React from "react";

/**
 * 焦点陷阱（命令面板 / Modal 可选启用）：
 * - Tab / Shift+Tab 在容器可聚焦元素内循环，不逃逸到背后页面；
 * - 只在包裹（wrap）时 preventDefault + stopPropagation：正常 Tab 冒泡无害，
 *   嵌套浮层（子 Dialog 在父 Modal 内）由子陷阱先处理，父陷阱不再二次干预；
 * - 隐藏子树（hidden 属性 / aria-hidden）内的元素不参与循环
 *   （SettingsView 按 section hidden 常驻挂载，必须排除）。
 */

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function getFocusableElements(root: HTMLElement): HTMLElement[] {
  const all = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return all.filter((el) => !el.closest("[hidden], [aria-hidden='true']"));
}

export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  active: boolean
): (e: React.KeyboardEvent) => void {
  return React.useCallback(
    (e: React.KeyboardEvent) => {
      if (!active || e.key !== "Tab") return;
      const root = containerRef.current;
      if (!root) return;
      const items = getFocusableElements(root);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (activeEl === first || !activeEl || !root.contains(activeEl))) {
        e.preventDefault();
        e.stopPropagation();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        e.stopPropagation();
        first.focus();
      }
    },
    [active]
  );
}
