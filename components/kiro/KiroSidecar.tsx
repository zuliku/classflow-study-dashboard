"use client";

import React from "react";
import { X, Expand, SquarePen } from "lucide-react";
import { useKiroSession } from "@/components/kiro/KiroSessionProvider";
import { KiroChatSurface } from "@/components/kiro/KiroChatSurface";
import { KiroMark } from "@/components/kiro/KiroHeader";

/**
 * Kiro Sidecar：贯穿 ClassFlow 的 AI Agent 入口。
 * 与 KiroWorkspace 共享同一个 Persistent Session（同一 Runtime / 附件 / Undo）。
 * Responsive：
 *  ≥1536  Docked（静态列，主内容 reflow）
 *  1280–1535  Right Overlay（border-left + shadow，不压窄课表）
 *  768–1279  Right Side Sheet
 *  <768  Full-screen
 */
export function KiroSidecar() {
  const session = useKiroSession();
  const { closeSidecar, expandSidecar, newChat, activeRefs } = session;

  return (
    <div
      data-testid="kiro-sidecar"
      className={cnSidecar()}
    >
      {/* Compact Header */}
      <div className="shrink-0 px-4 py-3 border-b border-line bg-[#F7F5F5] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <KiroMark size="sm" />
          <h2 className="text-sm font-bold text-charcoal" data-testid="kiro-sidecar-title">
            Kiro
          </h2>
          {activeRefs.length > 0 && (
            <span className="hidden sm:inline-block text-[10px] font-semibold text-sandrift bg-white border border-line px-1.5 py-0.5 rounded-md truncate max-w-[180px]">
              {activeRefs[0].label}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={newChat}
            aria-label="新对话"
            title="新对话"
            className="p-2 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
          >
            <SquarePen className="w-4 h-4" />
          </button>
          <button
            onClick={expandSidecar}
            aria-label="展开到 Kiro 工作区"
            title="展开"
            className="p-2 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
          >
            <Expand className="w-4 h-4" />
          </button>
          <button
            onClick={closeSidecar}
            aria-label="关闭 Kiro"
            title="关闭"
            className="p-2 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 同一 Conversation + Composer */}
      <KiroChatSurface variant="sidecar" />
    </div>
  );
}

function cnSidecar(): string {
  return [
    "flex flex-col bg-surface",
    // <768：全屏
    "fixed inset-0 z-40",
    "pb-[env(safe-area-inset-bottom)]",
    // 768–1279：右侧 Side Sheet
    "md:inset-y-0 md:right-0 md:left-auto md:w-[min(420px,88vw)]",
    // 1280–1535：Right Overlay（400px）
    "xl:w-[400px] shadow-drawer border-l border-line",
    // ≥1536：Docked（静态列，主内容 reflow）
    "2xl:static 2xl:z-auto 2xl:shadow-none 2xl:h-auto",
  ].join(" ");
}
