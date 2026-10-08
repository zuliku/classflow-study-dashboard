"use client";

import React from "react";
import { PopoverPanel, PopoverPanelProps } from "@/components/ui/Popover";
import { isVisibleElement } from "@/lib/focusVisibility";
import { cn } from "@/lib/utils";

/**
 * 全局 DropdownMenu primitives（UI Productization Task 2B1）：
 * 基于 PopoverPanel 的 command-menu 语义。
 * 无 submenu / shortcut / checkbox item / portal；keyboard roving（Arrow/Home/End）由面板统一处理。
 */
export type DropdownMenuPanelProps = PopoverPanelProps;

function focusMenuItem(container: HTMLElement | null, dir: 1 | -1 | "first" | "last"): void {
  if (!container) return;
  const items = Array.from(
    container.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not([disabled]),[role="menuitemradio"]:not([disabled])'
    )
    // 可见性走统一口径（不查 offsetParent/rects：jsdom 无布局，fixed 祖先下也误杀）
  ).filter((el) => isVisibleElement(el));
  if (items.length === 0) return;
  const active = document.activeElement as HTMLElement | null;
  const idx = active ? items.indexOf(active as HTMLButtonElement) : -1;
  const next =
    dir === "first" ? items[0] : dir === "last" ? items[items.length - 1] : items[(idx + dir + items.length) % items.length];
  next?.focus();
}

export function DropdownMenuPanel({ className, children, onKeyDown, ...props }: DropdownMenuPanelProps) {
  return (
    <PopoverPanel
      role="menu"
      className={cn("min-w-[190px] max-w-[300px] p-1 text-xs", className)}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.defaultPrevented) return;
        const target = e.currentTarget as HTMLElement;
        if (e.key === "ArrowDown") {
          e.preventDefault();
          focusMenuItem(target, 1);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          focusMenuItem(target, -1);
        } else if (e.key === "Home") {
          e.preventDefault();
          focusMenuItem(target, "first");
        } else if (e.key === "End") {
          e.preventDefault();
          focusMenuItem(target, "last");
        }
      }}
      {...props}
    >
      {children}
    </PopoverPanel>
  );
}

export interface DropdownMenuItemProps {
  icon?: React.ComponentType<{ className?: string }>;
  label: React.ReactNode;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
  danger?: boolean;
  disabled?: boolean;
  className?: string;
}

export function DropdownMenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
  disabled,
  className,
}: DropdownMenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left font-semibold transition-colors duration-[var(--motion-fast)]",
        danger ? "text-danger hover:bg-danger-bg" : "text-satin-grey hover:bg-alabaster hover:text-charcoal",
        disabled && "opacity-40 cursor-not-allowed hover:bg-transparent hover:text-inherit",
        className
      )}
    >
      {Icon ? <Icon className="w-3.5 h-3.5 shrink-0" /> : null}
      <span className="truncate">{label}</span>
    </button>
  );
}

export function DropdownMenuDivider({ className }: { className?: string }) {
  return <div role="separator" className={cn("my-1 h-px bg-line-soft", className)} />;
}
