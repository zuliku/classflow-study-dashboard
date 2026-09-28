"use client";

import React, { useEffect, useRef } from "react";
import { useAppStore } from "@/store/useAppStore";
import { KiroContextRef } from "@/lib/ai/context/types";
import { cn } from "@/lib/utils";
import { usePresence } from "@/lib/usePresence";
import { MOTION_EXIT_MS } from "@/lib/motion";
import { KiroContextListView } from "@/components/kiro/KiroContextListView";

/**
 * Context Picker（@）：从当前 Store 实时读取真实实体（属于 UI，不构建 Prompt、不发送数据）。
 * Desktop：absolute 弹层；Mobile：底部 sheet。
 * 列表内容与 Composer Add Menu 共用 KiroContextListView（单一数据/展示来源）。
 */
export function KiroContextPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (ref: KiroContextRef) => void;
}) {
  const contentDensity = useAppStore((s) => s.preferences.contentDensity);
  const compact = contentDensity === "compact";
  const mobilePanelRef = useRef<HTMLDivElement | null>(null);
  const desktopPanelRef = useRef<HTMLDivElement | null>(null);
  const { mounted, visible } = usePresence(open, MOTION_EXIT_MS.panel);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // 点击外部关闭（mobile / desktop 两套面板同时挂载，分别检查）
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      const inside =
        (mobilePanelRef.current?.contains(t) ?? false) || (desktopPanelRef.current?.contains(t) ?? false);
      if (!inside) onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, onClose]);

  if (!mounted) return null;

  const list = <KiroContextListView onPick={onPick} compact={compact} />;

  return (
    <>
      {/* Mobile：底部 sheet（<md） */}
      <div
        className={cn(
          "md:hidden fixed inset-0 z-40 bg-black/30 transition-opacity ease-[var(--ease-standard)]",
          visible
            ? "duration-[var(--motion-panel)] opacity-100"
            : "duration-[var(--motion-exit-panel)] opacity-0 pointer-events-none ease-[var(--ease-exit)]"
        )}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={mobilePanelRef}
        role="dialog"
        aria-label="选择上下文"
        data-state={open ? "open" : "closed"}
        aria-hidden={!open}
        className={cn(
          "md:hidden fixed inset-x-0 bottom-0 z-50 bg-surface border-t border-line rounded-t-2xl shadow-card p-4 pb-5 max-h-[70dvh] overflow-y-auto overflow-x-clip transition-[opacity,transform] ease-[var(--ease-standard)]",
          visible
            ? "duration-[var(--motion-panel)] translate-y-0 opacity-100"
            : "duration-[var(--motion-exit-panel)] translate-y-2 opacity-0 pointer-events-none ease-[var(--ease-exit)]"
        )}
      >
        <div className="w-10 h-1 rounded-full bg-line-strong mx-auto mb-3" />
        {list}
      </div>

      {/* Desktop：absolute 弹层（<md 隐藏）；Motion V1：kiro structure/popover timing + 2–3px offset */}
      <div
        ref={desktopPanelRef}
        role="dialog"
        aria-label="选择上下文"
        data-state={open ? "open" : "closed"}
        aria-hidden={!open}
        className={cn(
          "hidden md:block absolute bottom-full left-0 mb-2 w-80 max-h-[min(420px,60dvh)] overflow-y-auto overflow-x-clip bg-surface border border-line-strong rounded-2xl shadow-card p-3 z-40 transition-[opacity,transform] ease-[var(--ease-standard)] origin-bottom-left",
          visible
            ? "duration-[var(--kiro-motion-popover-enter,var(--motion-panel))] translate-y-0 opacity-100 scale-100"
            : "duration-[var(--kiro-motion-popover-exit,160ms)] translate-y-1 opacity-0 pointer-events-none scale-[0.985] ease-[var(--ease-exit)]"
        )}
      >
        {list}
      </div>
    </>
  );
}
