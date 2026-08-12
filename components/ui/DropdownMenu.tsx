"use client";

import React from "react";
import { PopoverPanel, PopoverPanelProps } from "@/components/ui/Popover";
import { cn } from "@/lib/utils";

/**
 * 全局 DropdownMenu primitives（UI Productization Task 2B1）：
 * 基于 PopoverPanel 的 command-menu 语义。
 * 无 submenu / shortcut / checkbox item / keyboard roving / portal。
 */
export type DropdownMenuPanelProps = PopoverPanelProps;

export function DropdownMenuPanel({ className, children, ...props }: DropdownMenuPanelProps) {
  return (
    <PopoverPanel
      role="menu"
      className={cn("min-w-[190px] max-w-[300px] p-1 text-xs", className)}
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
        "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left font-semibold transition-colors",
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

export function DropdownMenuDivider() {
  return <div role="separator" className="my-1 h-px bg-line-soft" />;
}
