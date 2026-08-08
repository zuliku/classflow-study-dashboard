"use client";

import React, { useEffect, useRef, useState } from "react";
import { Settings as SettingsIcon, Search, X } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { usePresence } from "@/lib/usePresence";
import { useRestoreFocus } from "@/lib/useRestoreFocus";
import { pushOverlay, popOverlay, isTopmostOverlay } from "@/lib/overlayStack";
import { SettingsView } from "@/components/settings/SettingsView";
import { cn } from "@/lib/utils";

const OVERLAY_ID = "settings-modal";

/**
 * 设置中心 Modal：居中弹层，固定宽高。
 * Header 内置设置搜索（Cmd/Ctrl+F 聚焦，仅 Modal 打开时拦截）。
 */
export function SettingsModal() {
  const isOpen = useAppStore((s) => s.isSettingsModalOpen);
  const setSettingsModalOpen = useAppStore((s) => s.setSettingsModalOpen);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const { mounted, visible } = usePresence(isOpen, 220);
  useRestoreFocus(isOpen);

  // Overlay Stack：Modal 层，Esc 只在最上层时关闭；Cmd/Ctrl+F 聚焦设置搜索
  useEffect(() => {
    if (!mounted) return;
    pushOverlay(OVERLAY_ID, 50);
    const onKey = (e: KeyboardEvent) => {
      const isTop = isTopmostOverlay(OVERLAY_ID);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => searchInputRef.current?.focus());
        return;
      }
      if (e.key === "Escape" && isTop) {
        if (searchOpen && document.activeElement === searchInputRef.current) {
          setSearchOpen(false);
          setSearchQuery("");
        } else {
          setSettingsModalOpen(false);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      popOverlay(OVERLAY_ID);
      window.removeEventListener("keydown", onKey);
    };
  }, [mounted, setSettingsModalOpen, searchOpen]);

  // 关闭 Modal 时重置搜索
  useEffect(() => {
    if (!isOpen) {
      setSearchOpen(false);
      setSearchQuery("");
    }
  }, [isOpen]);

  if (!mounted) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center md:p-4",
        "ux-overlay",
        visible ? "opacity-100" : "opacity-0"
      )}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) setSettingsModalOpen(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        className={cn(
          "w-full h-full md:w-[min(900px,calc(100vw-48px))] md:h-[min(680px,calc(100dvh-48px))]",
          "bg-surface rounded-none md:rounded-2xl shadow-drawer border border-line",
          "overflow-hidden flex flex-col",
          "ux-modal-panel",
          visible ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-[0.985] translate-y-1"
        )}
      >
        {/* Modal Header：设置标题 + 搜索 + 关闭 */}
        <div className="shrink-0 px-4 md:px-5 py-3 border-b border-[#F0EBE1] bg-[#F7F5F5] flex items-center justify-between gap-3">
          {searchOpen ? (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Search className="w-4 h-4 text-[#A48F82] shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索设置"
                aria-label="搜索设置"
                className="flex-1 min-w-0 bg-transparent text-sm text-charcoal placeholder-sandrift focus:outline-none"
              />
              <button
                onClick={() => {
                  setSearchOpen(false);
                  setSearchQuery("");
                }}
                className="p-1.5 rounded-lg text-sandrift hover:bg-alabaster transition-colors shrink-0"
                aria-label="关闭搜索"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2.5 min-w-0">
                <SettingsIcon className="w-4 h-4 text-[#A48F82] shrink-0" />
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-charcoal leading-tight">设置</h2>
                  <p className="text-[10px] text-sandrift truncate hidden sm:block">
                    学习环境、交互偏好与本地数据
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => {
                    setSearchOpen(true);
                    requestAnimationFrame(() => searchInputRef.current?.focus());
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white border border-line-strong text-sandrift hover:text-charcoal hover:bg-surface transition-colors text-[11px] font-semibold"
                >
                  <Search className="w-3.5 h-3.5" />
                  搜索设置
                  <kbd className="hidden md:inline-block bg-alabaster text-charcoal text-[9px] font-mono px-1 py-0.5 rounded border border-line-strong">
                    ⌘F
                  </kbd>
                </button>
                <button
                  onClick={() => setSettingsModalOpen(false)}
                  className="p-1.5 rounded-lg text-sandrift hover:bg-alba hover:text-charcoal transition-colors shrink-0"
                  aria-label="关闭"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </>
          )}
        </div>

        {/* 设置中心内容：Modal 固定高度内，仅右侧 detail 独立滚动 */}
        <SettingsView
          searchQuery={searchQuery}
          onClearSearch={() => {
            setSearchQuery("");
            setSearchOpen(false);
          }}
          jumpToSetting={() => {
            setSearchQuery("");
            setSearchOpen(false);
          }}
        />
      </div>
    </div>
  );
}
