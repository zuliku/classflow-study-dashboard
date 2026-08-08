"use client";

import React, { useEffect, useState } from "react";
import { Plus, X, MessageSquare } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";

/**
 * Kiro History（Task 1）：不做假历史记录。
 * Task 0 的 mock 列表已移除；正式本地持久化留到后续 Task。
 * 面板结构与未来持久化兼容（New Chat / select / 空状态）。
 */
export function KiroHistoryPanel({
  onClose,
  onNewChat,
}: {
  onClose: () => void;
  onNewChat: () => void;
}) {
  const contentDensity = useAppStore((s) => s.preferences.contentDensity);
  const compact = contentDensity === "compact";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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

      <div
        className={cn(
          "rounded-xl bg-[#F7F5F5] border border-line flex flex-col items-center justify-center text-center gap-2",
          compact ? "py-8" : "py-10"
        )}
      >
        <MessageSquare className="w-5 h-5 text-sandrift" />
        <p className="text-xs font-semibold text-satin-grey">暂无历史对话</p>
        <p className="text-[10px] text-sandrift px-6 leading-relaxed">
          对话记录将在后续版本中保存在本机。
        </p>
      </div>
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
