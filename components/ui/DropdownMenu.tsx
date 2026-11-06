"use client";

import React from "react";
import { PopoverPanel, PopoverPanelProps, usePopoverContext } from "@/components/ui/Popover";
import { isVisibleElement } from "@/lib/focusVisibility";
import { cn } from "@/lib/utils";

/**
 * 全局 DropdownMenu primitives（UI Productization Task 2B1）：
 * 基于 PopoverPanel 的 command-menu 语义。
 * 无 submenu / shortcut / checkbox item / portal；keyboard roving（Arrow/Home/End）由面板统一处理。
 * V6：打开即聚焦首项 / Esc 关闭（topmost 门控）/ 关闭归还触发焦点（独立使用时）。
 */
export interface DropdownMenuPanelProps extends PopoverPanelProps {
  /** 独立使用（无 Popover 包裹）时提供关闭入口；Popover 内自动从 Context 获取 */
  onOpenChange?: (open: boolean) => void;
}

function focusMenuItem(container: HTMLElement | null, dir: 1 | -1 | "first" | "last"): boolean {
  if (!container) return false;
  const items = Array.from(
    container.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not([disabled]),[role="menuitemradio"]:not([disabled])'
    )
    // 可见性走统一口径（不查 offsetParent/rects：jsdom 无布局，fixed 祖先下也误杀）
  ).filter((el) => isVisibleElement(el));
  if (items.length === 0) return false;
  const active = document.activeElement as HTMLElement | null;
  const idx = active ? items.indexOf(active as HTMLButtonElement) : -1;
  const next =
    dir === "first" ? items[0] : dir === "last" ? items[items.length - 1] : items[(idx + dir + items.length) % items.length];
  next?.focus();
  return true;
}

export function DropdownMenuPanel({
  className,
  children,
  onKeyDown,
  onOpenChange,
  open,
  tabIndex,
  ...props
}: DropdownMenuPanelProps) {
  const popover = usePopoverContext();
  const hasPopover = !!popover;
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const openerRef = React.useRef<HTMLElement | null>(null);
  const resolvedOnOpenChange = onOpenChange ?? popover?.onOpenChange;

  // 打开：记录触发元素并聚焦首项（菜单可立即 Arrow/Enter，不再依赖 Tab）。
  // 关闭：独立使用时把焦点还给触发元素；Popover 内交给 useRestoreFocus，避免双还焦。
  React.useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    let raf = 0;
    let attempts = 0;
    const tryFocus = () => {
      const panel = panelRef.current;
      if (!panel) return;
      // 面板 presence 首帧仍处于 inert（退出窗口守卫）：等它可见后再移焦，避免聚焦失败
      if (panel.closest("[inert]") && attempts++ < 6) {
        raf = requestAnimationFrame(tryFocus);
        return;
      }
      if (panel.contains(document.activeElement)) return;
      if (!focusMenuItem(panel, "first")) panel.focus({ preventScroll: true });
    };
    raf = requestAnimationFrame(tryFocus);
    return () => {
      cancelAnimationFrame(raf);
      const opener = openerRef.current;
      openerRef.current = null;
      if (hasPopover) return;
      if (opener && document.contains(opener) && isVisibleElement(opener)) opener.focus();
    };
  }, [open, hasPopover]);

  return (
    <PopoverPanel
      ref={panelRef}
      role="menu"
      tabIndex={tabIndex ?? -1}
      className={cn("ux-menu-stagger min-w-[190px] max-w-[300px] p-1 text-xs focus:outline-none", className)}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.defaultPrevented) return;
        if (e.key === "Escape") {
          if (!resolvedOnOpenChange) return;
          // 上层 Dialog/Confirm 存在时 Esc 归它；避免后台菜单抢关闭
          if (popover && !popover.isTopmost()) return;
          e.preventDefault();
          e.stopPropagation();
          resolvedOnOpenChange(false);
          return;
        }
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
      open={open}
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
        "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left font-semibold transition-[background-color,color,opacity] duration-[var(--motion-fast)] active:opacity-80",
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
