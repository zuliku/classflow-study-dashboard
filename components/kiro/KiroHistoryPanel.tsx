"use client";

import React, { useEffect, useState } from "react";
import { Plus, MoreHorizontal, X } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";

interface HistoryItem {
  id: string;
  title: string;
  time: string;
}

const MOCK_HISTORY: HistoryItem[] = [
  { id: "h1", title: "关于本周安排的对话", time: "今天 14:20" },
  { id: "h2", title: "帮我看看最近的 DDL", time: "今天 09:05" },
  { id: "h3", title: "制定期末复习计划", time: "昨天" },
  { id: "h4", title: "分析本周课程负担", time: "周二" },
  { id: "h5", title: "任务优先级梳理", time: "8月1日" },
];

/**
 * Kiro History：Workspace 内轻量 panel/sheet（不进入 Global Sidebar，避免 Sidebar in Sidebar）。
 * Task 0 不持久化，关闭页面后消失。支持 New Chat / select / rename / delete 占位。
 */
export function KiroHistoryPanel({
  onClose,
  onNewChat,
}: {
  onClose: () => void;
  onNewChat: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const contentDensity = useAppStore((s) => s.preferences.contentDensity);
  const compact = contentDensity === "compact";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuFor(null);
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rowCls = cn(
    "w-full flex items-center gap-2 rounded-xl text-left text-xs transition-colors hover:bg-alabaster",
    compact ? "py-2 px-2.5" : "py-2.5 px-3"
  );

  const list = (
    <>
      <div className="flex items-center justify-between gap-2 px-1 pb-2">
        <h3 className="text-xs font-bold text-charcoal">最近对话</h3>
        <button
          onClick={onNewChat}
          aria-label="新对话"
          className="flex items-center gap-1 px-2 h-8 rounded-lg text-[11px] font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          新对话
        </button>
      </div>

      <div className="space-y-0.5">
        {MOCK_HISTORY.map((h) => {
          const isActive = selected === h.id;
          return (
            <div key={h.id} className="relative group">
              <button
                onClick={() => setSelected(h.id)}
                aria-current={isActive ? "true" : undefined}
                className={cn(
                  rowCls,
                  isActive
                    ? "bg-pastel-mint text-charcoal font-semibold"
                    : "text-satin-grey font-medium"
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{h.title}</span>
                  <span className={cn("block text-[10px] text-sandrift", compact && "mt-0")}>
                    {h.time}
                  </span>
                </span>
              </button>
              <button
                onClick={() => setMenuFor(menuFor === h.id ? null : h.id)}
                aria-label={`${h.title} 更多操作`}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
              >
                <MoreHorizontal className="w-3.5 h-3.5" />
              </button>
              {menuFor === h.id && (
                <div
                  role="menu"
                  aria-label="对话操作"
                  className="absolute right-2 top-full mt-0.5 w-28 bg-surface border border-line-strong rounded-xl shadow-card p-1 z-20 ux-inline"
                >
                  <button
                    role="menuitem"
                    onClick={() => setMenuFor(null)}
                    className="w-full px-3 py-2 rounded-lg text-left text-[11px] font-semibold text-charcoal hover:bg-alabaster"
                  >
                    重命名
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => setMenuFor(null)}
                    className="w-full px-3 py-2 rounded-lg text-left text-[11px] font-semibold text-danger hover:bg-danger-bg"
                  >
                    删除
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="px-1 pt-3 text-[10px] text-sandrift">界面预览：对话记录暂不持久化。</p>
    </>
  );

  return (
    <>
      {/* 遮罩（mobile sheet 与 desktop panel 共用，点击关闭） */}
      <div className="absolute inset-0 z-30 bg-black/20 md:bg-transparent" onClick={onClose} aria-hidden="true" />

      {/* Mobile：底部 sheet */}
      <div
        role="dialog"
        aria-label="历史记录"
        className="md:hidden absolute inset-x-0 bottom-0 z-40 bg-surface border-t border-line rounded-t-2xl shadow-card p-4 pb-5 max-h-[65dvh] overflow-y-auto ux-inline"
      >
        <div className="w-10 h-1 rounded-full bg-line-strong mx-auto mb-3" />
        {list}
      </div>

      {/* Desktop：右侧 280px 次级 panel */}
      <div
        role="dialog"
        aria-label="历史记录"
        className="hidden md:block absolute right-0 top-0 bottom-0 w-[280px] z-40 bg-surface border-l border-line shadow-card overflow-y-auto p-3 ux-drawer-panel"
      >
        <div className="flex items-center justify-between px-1 pb-2">
          <h3 className="text-sm font-bold text-charcoal">历史记录</h3>
          <button
            onClick={onClose}
            aria-label="关闭历史记录"
            className="p-1.5 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {list}
      </div>
    </>
  );
}
