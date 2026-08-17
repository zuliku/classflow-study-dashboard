"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  DropdownMenuPanel,
  DropdownMenuItem,
  DropdownMenuDivider,
} from "@/components/ui/DropdownMenu";

/**
 * Kiro 兼容层（UI Productization Task 2B1）：
 * 保留 Kiro API（useKiroPopover / KiroMenuPanel / KiroMenuItem / KiroMenuDivider），
 * Panel/Item/Divider 委托全局 DropdownMenu primitives。
 * useKiroPopover 行为保持不变（Kiro consumer 无需迁移 import）。
 */

/** Esc + 点击外部关闭（保持原实现） */
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
  open,
  className,
  children,
}: {
  placement?: "bottom-end" | "top-end" | "right-end";
  open?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenuPanel open={open} placement={placement} motionProfile="kiro" className={className}>
      {children}
    </DropdownMenuPanel>
  );
}

export function KiroMenuItem(props: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return <DropdownMenuItem {...props} />;
}

export function KiroMenuDivider({ className }: { className?: string }) {
  return <DropdownMenuDivider className={className} />;
}
