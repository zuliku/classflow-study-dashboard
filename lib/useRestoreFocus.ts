import { useEffect, useRef } from "react";

/**
 * 打开 Overlay 时记录触发元素，关闭后把焦点还给它，
 * 避免关闭 Modal / Drawer 后焦点丢失到 body。
 *
 * opt-in restoreKey（Detail Panel 实体切换用）：
 * - open=true 且 restoreKey 变化（如详情从 Task A 切到 Task B）→ 在安全条件下把 opener
 *   更新为“最近一次导致实体切换的可聚焦 trigger”，关闭后焦点回到当前实体，而非旧实体。
 * - 不提供 restoreKey 的 consumer：行为与旧版完全一致（只在 open 变化时记录）。
 * 安全条件：activeElement 是有效 HTMLElement 且不是 body。
 */
export function useRestoreFocus(open: boolean, restoreKey?: string | number | null): void {
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      const el = document.activeElement as HTMLElement | null;
      if (el && el !== document.body) openerRef.current = el;
    } else if (openerRef.current && typeof openerRef.current.focus === "function") {
      openerRef.current.focus();
      openerRef.current = null;
    }
  }, [open, restoreKey]);
}
