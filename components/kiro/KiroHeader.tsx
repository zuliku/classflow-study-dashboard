"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { KiroSessionActions } from "@/components/kiro/KiroSessionActions";
import { KiroLogoIcon } from "@/components/kiro/KiroLogo";

/**
 * Kiro Mark：正式 Kiro Logo 直接展示（无方形容器 / 无背景 / 无边框）。
 * sm ≈ 20px、md ≈ 28px、lg ≈ 40px（按 PNG 透明边距做光学尺寸，object-contain 保比例）。
 */
export function KiroMark({ size = "md", className }: { size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <KiroLogoIcon
      className={cn(
        size === "sm" && "w-5 h-5",
        size === "md" && "w-7 h-7",
        size === "lg" && "w-10 h-10",
        className
      )}
    />
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
