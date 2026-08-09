"use client";

import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Kiro 共享 Popover 基础设施：Share Sheet / 会话 More / Message More / 未来菜单统一使用。
 * 样式约定：surface / border-line-strong / rounded-2xl / shadow-card / text-xs / hover:bg-alabaster。
 */

/** Esc + 点击外部关闭 */
export function useKiroPopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return {
    open,
    setOpen,
    toggle: () => setOpen((v) => !v),
    close: () => setOpen(false),
    ref,
  };
}

export function KiroMenuPanel({
  placement = "bottom-end",
  className,
  children,
}: {
  /** bottom-end：右上按钮向下展开（Header）；top-end：底部按钮向上展开（Message / Expanded Rail）；
      right-end：窄 Rail 按钮向右展开（左侧 Collapsed Rail 专用） */
  placement?: "bottom-end" | "top-end" | "right-end";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="menu"
      className={cn(
        "absolute right-0 z-40 bg-surface border border-line-strong rounded-2xl shadow-card ux-inline p-1",
        "min-w-[190px] max-w-[300px] text-xs",
        "max-h-[min(420px,60vh)] overflow-y-auto",
        placement === "bottom-end" && "top-full mt-1.5",
        placement === "top-end" && "bottom-full mb-1.5",
        placement === "right-end" && "left-full right-auto bottom-0 ml-2",
        className
      )}
    >
      {children}
    </div>
  );
}

export function KiroMenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
  disabled,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left font-semibold transition-colors",
        danger
          ? "text-danger hover:bg-danger-bg"
          : "text-satin-grey hover:bg-alabaster hover:text-charcoal",
        disabled && "opacity-40 cursor-not-allowed hover:bg-transparent hover:text-inherit",
        className
      )}
    >
      {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}
      <span className="truncate">{label}</span>
    </button>
  );
}

export function KiroMenuDivider() {
  return <div className="my-1 h-px bg-line-soft" />;
}
