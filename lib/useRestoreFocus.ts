import { useEffect, useRef } from "react";

/**
 * 打开 Overlay 时记录触发元素，关闭后把焦点还给它，
 * 避免关闭 Modal / Drawer 后焦点丢失到 body。
 */
export function useRestoreFocus(open: boolean): void {
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      openerRef.current = document.activeElement as HTMLElement | null;
    } else if (openerRef.current && typeof openerRef.current.focus === "function") {
      openerRef.current.focus();
      openerRef.current = null;
    }
  }, [open]);
}
