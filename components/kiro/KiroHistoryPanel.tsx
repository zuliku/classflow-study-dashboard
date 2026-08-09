"use client";

import React, { useEffect } from "react";
import { Plus, X, MessageSquare } from "lucide-react";

/**
 * Kiro History：不做假历史记录（本地持久化在后续版本）。
 * desktop：full-height docked secondary panel（由 KiroWorkspace 作为 flex sibling 提供宽度/边框，
 *  顶部无空隙、底部无空隙、border-l 连续——不再是悬浮在 main padding 内的 absolute 卡片）。
 * mobile：底部 sheet。
 * 未来持久化后：在列表容器内渲染 list rows（紧凑、hover、当前会话 active、标题截断）。
 */
export function KiroHistoryPanel({
  variant,
  onClose,
  onNewChat,
}: {
  variant: "desktop" | "mobile";
  onClose: () => void;
  onNewChat: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** 最近对话 section + 列表容器（空状态在容器内部，不悬浮） */
  const list = (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold text-charcoal">最近对话</h3>
        <button
          onClick={onNewChat}
          aria-label="新对话"
          className="flex items-center gap-1 px-2 h-8 rounded-lg text-[11px] font-bold text-satin-grey hover:bg-alabaster hover:text-charcoal transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          新对话
        </button>
      </div>

      {/* 列表容器：有历史时渲染 rows；无历史时空状态占据容器 */}
      <div className="rounded-2xl bg-[#F7F5F5] border border-line min-h-[300px] flex flex-col overflow-hidden">
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-2.5 px-6 py-10">
          <span className="w-10 h-10 rounded-xl bg-alabaster flex items-center justify-center shrink-0">
            <MessageSquare className="w-[18px] h-[18px] text-sandrift" />
          </span>
          <p className="text-sm font-semibold text-charcoal">暂无历史对话</p>
          <p className="text-xs text-sandrift leading-relaxed max-w-[220px]">
            对话记录将在后续版本中保存在本机。
          </p>
        </div>
      </div>
    </div>
  );

  if (variant === "mobile") {
    return (
      <>
        {/* 遮罩 */}
        <div className="absolute inset-0 z-30 bg-black/20" onClick={onClose} aria-hidden="true" />
        {/* 底部 sheet */}
        <div
          role="dialog"
          aria-label="历史记录"
          className="absolute inset-x-0 bottom-0 z-40 bg-surface border-t border-line rounded-t-2xl shadow-card p-4 pb-5 max-h-[65dvh] overflow-y-auto ux-inline"
        >
          <div className="w-10 h-1 rounded-full bg-line-strong mx-auto mb-4" />
          {list}
        </div>
      </>
    );
  }

  // Desktop：full-height docked panel（高度由父级 flex 容器决定）
  return (
    <div role="dialog" aria-label="历史记录" className="h-full flex flex-col">
      {/* 顶部标题区：与 Kiro Header 同一高度语言 */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-line">
        <h3 className="text-sm font-bold text-charcoal">历史记录</h3>
        <button
          onClick={onClose}
          aria-label="关闭历史记录"
          className="p-1.5 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4">{list}</div>
    </div>
  );
}
