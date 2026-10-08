import React from "react";
import { isVisibleElement, isFieldsetDisabled } from "@/lib/focusVisibility";

/**
 * 焦点陷阱（命令面板 / Modal 可选启用）：
 * - Tab / Shift+Tab 在容器可聚焦元素内循环，不逃逸到背后页面；
 * - 只在包裹（wrap）时 preventDefault + stopPropagation：正常 Tab 冒泡无害，
 *   嵌套浮层（子 Dialog 独立 portal 挂到 body，但 React 树在父 Modal 内）由子陷阱先处理，
 *   父陷阱不再二次干预；
 * - 事件目标在容器 DOM 子树之外（嵌套 portal 经 React 树冒泡上来）→ 直接忽略，
 *   交给子陷阱 own（S2-1 嵌套守卫：此前父陷阱会把子内 Shift+Tab 拽回父末尾）；
 * - 隐藏子树（hidden 属性 / aria-hidden）内的元素不参与循环
 *   （SettingsView 按 section hidden 常驻挂载，必须排除）。
 */

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function getFocusableElements(root: HTMLElement): HTMLElement[] {
  const all = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  // 可见性走统一口径（lib/focusVisibility）：hidden/aria-hidden/inert + 计算样式，
  // 不查 offsetParent/rects（jsdom 无布局恒空，fixed/transform 祖先下也为 null，会误杀）
  return all.filter((el) => isVisibleElement(el) && !isFieldsetDisabled(el));
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
      // S2-1 嵌套守卫：目标在子树外（子 portal 经 React 树冒泡）→ 子陷阱 own，父不干预
      const target = e.target as Node | null;
      if (target && !root.contains(target)) return;
      const items = getFocusableElements(root);
      if (items.length === 0) {
        // P1：空列表不再 preventDefault 锁死键盘（此前 Tab 被吞，用户无法移出）
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
