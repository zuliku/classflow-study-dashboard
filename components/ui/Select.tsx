"use client";

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * ClassFlow 通用 Select（Settings V3 Task 6）：
 * 自定义 trigger + anchored dropdown（portal 到 body，避免被 Settings overflow 容器裁切）。
 * - ARIA：trigger role=combobox / aria-haspopup=listbox / aria-expanded / aria-activedescendant；
 *   menu role=listbox；item role=option / aria-selected
 * - 键盘：Enter/Space 打开；↑↓ 导航；Home/End；Enter 选择；Escape 关闭并聚焦回 trigger；Tab 关闭
 * - 鼠标：click 打开/选择；outside click 关闭；scroll/resize 关闭
 * - 动画：open = opacity + translateY(2px→0)（--motion-fast）；reduced motion 无动画
 * - focus：mouse 点击不保留刺眼 ring；键盘 focus-visible 轻量 ring（:focus-visible）
 */

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
}

interface UISelectProps<T extends string | number> {
  value: T;
  onChange: (v: T) => void;
  options: SelectOption<T>[];
  ariaLabel?: string;
  disabled?: boolean;
  /** value 未匹配任何 option 时显示（如批量操作占位） */
  placeholder?: string;
  /** trigger 样式（SettingsSelect 传入 Settings 规格） */
  triggerClassName?: string;
  /** 菜单容器附加样式 */
  menuClassName?: string;
  /** 菜单项高度（默认 h-9） */
  itemClassName?: string;
  testid?: string;
}

export function UISelect<T extends string | number>({
  value,
  onChange,
  options,
  ariaLabel,
  disabled,
  triggerClassName,
  menuClassName,
  itemClassName,
  placeholder,
  testid,
}: UISelectProps<T>) {
  const baseId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const listboxId = `select-listbox-${baseId}`;
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(0, options.findIndex((o) => o.value === value))
  );
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const [menuWidth, setMenuWidth] = useState<number | undefined>(undefined);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));

  const reducedMotion =
    typeof document !== "undefined" && document.documentElement.dataset.motion === "reduced";

  // 打开：先挂载（opacity-0）→ 下一帧切到可见（opacity-100 + translate-y-0）
  const openMenu = useCallback(() => {
    if (disabled || options.length === 0) return;
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const itemH = 36; // h-9
    const estHeight = Math.min(options.length * itemH + 8, 280);
    const gap = 6;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUp = spaceBelow < estHeight + gap && spaceAbove > spaceBelow;
    const top = openUp ? rect.top - estHeight - gap : rect.bottom + gap;
    setMenuStyle({
      position: "fixed",
      top: Math.max(8, top),
      left: rect.left,
      width: rect.width,
      maxHeight: openUp ? Math.min(estHeight, spaceAbove - 16) : Math.min(estHeight, spaceBelow - 16),
    });
    setMenuWidth(rect.width);
    setOpen(true);
    setActiveIndex(options.findIndex((o) => o.value === value));
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    if (reducedMotion) {
      setVisible(true);
    } else {
      setVisible(false);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setVisible(true);
      });
    }
  }, [disabled, options, value, reducedMotion]);

  // 关闭：先切不可见（fade）→ 动画结束后卸载
  const closeMenu = useCallback(() => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    setVisible(false);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setOpen(false);
    }, reducedMotion ? 0 : 120);
  }, [reducedMotion]);

  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    []
  );

  // outside click / scroll / resize 关闭
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      closeMenu();
    };
    const onScroll = () => closeMenu();
    const onResize = () => closeMenu();
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, closeMenu]);

  // Escape 全局（菜单打开且可见时拦截；淡出中不拦截，避免吞掉 Modal / Drawer 的 Escape）
  const visibleRef = useRef(visible);
  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && visibleRef.current) {
        e.stopPropagation();
        closeMenu();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, closeMenu]);

  // 打开时聚焦到当前选中项
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      menuRef.current
        ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
        ?.focus({ preventScroll: true });
    });
  }, [open, activeIndex]);

  const selectOption = (index: number) => {
    const opt = options[index];
    if (!opt) return;
    onChange(opt.value);
    // 选择完成：立即卸载（不保留淡出窗口，避免拦截紧随其后的 Escape / 上层交互）
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
    setVisible(false);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openMenu();
    }
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + options.length) % options.length);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      selectOption(activeIndex);
    } else if (e.key === "Tab") {
      closeMenu();
    }
  };

  const selectedLabel = options.find((o) => o.value === value)?.label ?? placeholder ?? "";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={ariaLabel}
        aria-activedescendant={open ? `${listboxId}-option-${activeIndex}` : undefined}
        disabled={disabled}
        data-testid={testid}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          "flex items-center justify-between gap-2 px-2.5 h-9 rounded-lg bg-[#F7F5F5] border border-line text-xs font-bold text-charcoal cursor-pointer",
          "focus:outline-none focus:border-charcoal focus-visible:outline-2 focus-visible:outline-charcoal/30",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          "transition-colors duration-[var(--motion-fast)]",
          triggerClassName
        )}
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown
          className={cn(
            "w-3.5 h-3.5 text-sandrift shrink-0 transition-transform duration-[var(--motion-fast)]",
            open && "rotate-180"
          )}
          aria-hidden="true"
        />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            style={{ ...menuStyle, width: menuWidth }}
            className={cn(
              "z-[60] overflow-y-auto rounded-lg border border-line bg-surface shadow-card py-1",
              "transition-opacity transition-transform duration-[var(--motion-fast)] ease-[var(--ease-standard)]",
              visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-0.5",
              reducedMotion && "transition-none transform-none",
              menuClassName
            )}
            onKeyDown={onMenuKeyDown}
          >
            {options.map((opt, i) => {
              const isSelected = opt.value === value;
              const isActive = i === activeIndex;
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  id={`${listboxId}-option-${i}`}
                  role="option"
                  aria-selected={isSelected}
                  data-index={i}
                  tabIndex={-1}
                  onClick={() => selectOption(i)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={cn(
                    "flex w-full items-center gap-2 px-2.5 text-xs font-semibold text-left",
                    "focus:outline-none",
                    itemClassName ?? "h-9",
                    isSelected
                      ? "bg-pastel-mint/50 text-charcoal font-bold"
                      : isActive
                        ? "bg-alabaster text-charcoal"
                        : "text-satin-grey hover:bg-alabaster hover:text-charcoal"
                  )}
                >
                  <span className="w-4 shrink-0 flex items-center justify-center">
                    {isSelected && <Check className="w-3.5 h-3.5 text-charcoal" aria-hidden="true" />}
                  </span>
                  <span className="truncate">{opt.label}</span>
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}
