/**
 * 可见性统一口径（焦点/菜单/搜索三轨收敛）：
 * - 只看 hidden / aria-hidden / inert + getComputedStyle(display/visibility)
 * - 刻意不查 offsetParent/getClientRects：jsdom 无布局恒为 null/空，
 *   fixed/transform 祖先下 offsetParent 也为 null，会误杀可见元素
 * - 无样式环境（单测 SSR）按可见处理，与 useFocusTrap 历史语义一致
 */
export function isVisibleElement(el: HTMLElement | null | undefined): boolean {
  if (!el) return false;
  if (el.closest("[hidden],[aria-hidden='true'],[inert]")) return false;
  let cs: CSSStyleDeclaration | null = null;
  try {
    cs = getComputedStyle(el);
  } catch {
    return true;
  }
  if (!cs) return true;
  if (cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse") {
    return false;
  }
  return true;
}

/** fieldset[disabled] 内的表单元素不可聚焦（仅焦点陷阱收集用，菜单/搜索不需要） */
export function isFieldsetDisabled(el: HTMLElement): boolean {
  return !!el.closest("fieldset[disabled]");
}
