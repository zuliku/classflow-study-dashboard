import { useCallback } from "react";

/**
 * 退出期 inert 守卫（对称进退的安全半边）：
 * presence 延迟卸载窗口内，内容视觉仍在但必须不可 Tab 聚焦、不可点击生效
 * （pointer-events-none 只防鼠标，键盘与读屏需要 inert）。
 * ExitCollapse / DisclosureRegion 内建此语义；手写 presence 的浮层用本 hook 补齐。
 *
 * 回调 ref 实现（而非 effect + 对象 ref）：
 * - React 18 types 下 RefObject<T | null> 无法直接赋给 ref prop；
 * - 条件渲染节点后挂载时仍能拿到当前 hidden（effect 版在挂载后不再执行，会漏设）。
 * hidden 翻转即换 identity，React 先 detach(null) 再 attach(node)，总能落到最新值。
 */
export function useInertOnHidden<T extends HTMLElement>(hidden: boolean): React.RefCallback<T> {
  return useCallback(
    (node: T | null) => {
      if (!node) return;
      if (hidden) node.setAttribute("inert", "");
      else node.removeAttribute("inert");
    },
    [hidden]
  );
}
