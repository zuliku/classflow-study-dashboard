"use client";

import React, { useEffect, useRef, useState } from "react";
import { MoreHorizontal, ChevronUp } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";
import {
  BOTTOM_NAV_MAIN,
  BOTTOM_NAV_MORE,
  MORE_TAB_IDS,
  NavItem,
} from "@/components/layout/navItems";

/** 移动端（<768px）底部导航：4 个主入口 + 「更多」轻量菜单 */
export function BottomNav() {
  const { activeTab, setActiveTab } = useAppStore();
  const [moreOpen, setMoreOpen] = useState(false);
  const navRef = useRef<HTMLElement | null>(null);

  const isMoreActive = MORE_TAB_IDS.includes(activeTab);

  // 点击外部 / Esc 关闭「更多」菜单
  useEffect(() => {
    if (!moreOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  const handleSelect = (id: NavItem["id"]) => {
    setMoreOpen(false);
    setActiveTab(id);
  };

  const navItemClass = (isActive: boolean) =>
    cn(
      "flex flex-col items-center justify-center gap-0.5 flex-1 h-14 min-w-0 transition-colors duration-[var(--motion-fast)]",
      isActive ? "text-charcoal" : "text-sandrift hover:text-charcoal"
    );

  return (
    <nav
      ref={navRef}
      aria-label="底部导航"
      className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-surface/95 backdrop-blur border-t border-line select-none"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex items-stretch">
        {BOTTOM_NAV_MAIN.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => handleSelect(item.id)}
              aria-label={item.label}
              aria-current={isActive ? "page" : undefined}
              className={navItemClass(isActive)}
            >
              <span
                className={cn(
                  "flex items-center justify-center w-11 h-7 rounded-full transition-colors duration-[var(--motion-fast)]",
                  isActive && "bg-pastel-mint"
                )}
              >
                <Icon className="w-5 h-5" />
              </span>
              <span className="text-[10px] font-semibold leading-none">
                {item.label}
              </span>
            </button>
          );
        })}

        {/* 更多：打开轻量菜单 */}
        <button
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
          aria-haspopup="menu"
          className={navItemClass(isMoreActive)}
        >
          <span
            className={cn(
              "flex items-center justify-center w-11 h-7 rounded-full transition-colors duration-[var(--motion-fast)]",
              isMoreActive && "bg-pastel-mint"
            )}
          >
            <MoreHorizontal className="w-5 h-5" />
          </span>
          <span className="text-[10px] font-semibold leading-none">更多</span>
        </button>
      </div>

      {/* 更多菜单 */}
      <div
        className={cn(
          "absolute bottom-full right-3 mb-2 w-44 bg-surface border border-line rounded-2xl shadow-card p-1.5 ux-inline",
          moreOpen ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1 pointer-events-none"
        )}
        role="menu"
        hidden={!moreOpen}
      >
        {BOTTOM_NAV_MORE.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              role="menuitem"
              onClick={() => handleSelect(item.id)}
              className={cn(
                "w-full flex items-center space-x-2.5 px-3 py-2.5 rounded-xl text-xs font-medium text-left transition-colors",
                isActive
                  ? "bg-pastel-mint text-charcoal font-semibold"
                  : "text-satin-grey hover:bg-alabaster hover:text-charcoal"
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{item.label}</span>
              {isActive && <ChevronUp className="w-3 h-3 ml-auto opacity-60" />}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
