"use client";

import React from "react";
import { KIRO_ICON } from "@/components/layout/navItems";
import { cn } from "@/lib/utils";
import { KiroSessionActions } from "@/components/kiro/KiroSessionActions";

/** Kiro Mark：所有 Kiro 入口共用的视觉标记（正式 Logo 落地后替换 KIRO_ICON 即可） */
export function KiroMark({ size = "md", className }: { size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex items-center justify-center rounded-xl bg-pastel-mint border border-line-soft text-charcoal shrink-0",
        size === "sm" && "w-7 h-7",
        size === "md" && "w-9 h-9",
        size === "lg" && "w-14 h-14 rounded-2xl",
        className
      )}
    >
      <KIRO_ICON
        className={cn(
          "text-charcoal",
          size === "sm" && "w-3.5 h-3.5",
          size === "md" && "w-4 h-4",
          size === "lg" && "w-6 h-6"
        )}
      />
    </span>
  );
}

/**
 * Kiro Workspace 内部 Header：轻量，不承载 Provider / API Key / token 等技术信息。
 * 左侧：Kiro mark + 名称（+ 低权重 AI Workspace 标签）；右侧：会话级操作（Share / More）。
 * 新对话 / 历史记录 移入 More 菜单（结构预留，便于后续 Share / More 扩展）。
 */
export function KiroHeader({
  onNewChat,
  onOpenHistory,
}: {
  onNewChat: () => void;
  onOpenHistory: () => void;
}) {
  return (
    <div className="shrink-0 flex items-center justify-between gap-3 pb-3 mb-1">
      <div className="flex items-center gap-2.5 min-w-0">
        <KiroMark size="md" />
        <div className="min-w-0">
          <h2 className="text-base font-bold text-charcoal leading-tight" data-testid="kiro-header-title">
            Kiro
          </h2>
        </div>
        <span className="hidden sm:inline-block text-[10px] font-semibold text-sandrift bg-[#F7F5F5] border border-line px-1.5 py-0.5 rounded-md leading-none">
          AI Workspace
        </span>
      </div>

      <KiroSessionActions variant="workspace" onNewChat={onNewChat} onOpenHistory={onOpenHistory} />
    </div>
  );
}
