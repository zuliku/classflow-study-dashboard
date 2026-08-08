"use client";

import React, { useEffect } from "react";
import { Settings as SettingsIcon, X } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { usePresence } from "@/lib/usePresence";
import { useRestoreFocus } from "@/lib/useRestoreFocus";
import { pushOverlay, popOverlay, isTopmostOverlay } from "@/lib/overlayStack";
import { SettingsView } from "@/components/settings/SettingsView";
import { cn } from "@/lib/utils";

const OVERLAY_ID = "settings-modal";

/**
 * 设置中心 Modal：居中弹层，固定宽高（不随 section 内容变化）。
 * <768：全屏设置页（顶部关闭 + 横向 tabs + 内容滚动）。
 * ≥768：双栏（左设置导航固定，右 detail 独立滚动）。
 * 复用现有 usePresence / useRestoreFocus / overlayStack 模式，Esc 与遮罩关闭。
 */
export function SettingsModal() {
  const isOpen = useAppStore((s) => s.isSettingsModalOpen);
  const setSettingsModalOpen = useAppStore((s) => s.setSettingsModalOpen);

  const { mounted, visible } = usePresence(isOpen, 220);
  useRestoreFocus(isOpen);

  // Overlay Stack：Modal 层，Esc 只在最上层时关闭
  useEffect(() => {
    if (!mounted) return;
    pushOverlay(OVERLAY_ID, 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopmostOverlay(OVERLAY_ID)) setSettingsModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      popOverlay(OVERLAY_ID);
      window.removeEventListener("keydown", onKey);
    };
  }, [mounted, setSettingsModalOpen]);

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
        {/* Modal Header：极简，不做大 Banner */}
        <div className="shrink-0 px-4 md:px-5 py-3 border-b border-[#F0EBE1] bg-[#F7F5F5] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <SettingsIcon className="w-4 h-4 text-[#A48F82] shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-charcoal leading-tight">设置</h2>
              <p className="text-[10px] text-sandrift truncate hidden sm:block">
                账户、学期、偏好与本地数据管理
              </p>
            </div>
          </div>
          <button
            onClick={() => setSettingsModalOpen(false)}
            className="p-1.5 rounded-lg text-sandrift hover:bg-alba hover:text-charcoal transition-colors shrink-0"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 设置中心内容：Modal 固定高度内，仅右侧 detail 独立滚动 */}
        <SettingsView />
      </div>
    </div>
  );
}
