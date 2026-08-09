"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { KiroSessionActions } from "@/components/kiro/KiroSessionActions";
import { KiroLogoIcon } from "@/components/kiro/KiroLogo";
import { useKiroSession } from "@/components/kiro/KiroSessionProvider";

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
 * Kiro Workspace Thread Header（Codex-style）：
 * 不再展示 Kiro Logo / 名称 / AI Workspace（品牌由 Floating Thread Rail 与 Assistant Turn 承担）。
 * 左侧：当前 Thread 标题（复用 session.conversationTitle，无则「新对话」）；
 * 右侧：会话级操作（Share / More）。
 */
export function KiroHeader({
  onNewChat,
  onOpenHistory,
}: {
  onNewChat: () => void;
  onOpenHistory: () => void;
}) {
  const { conversationTitle } = useKiroSession();

  return (
    <div className="shrink-0 flex items-center justify-between gap-3 pb-3 mb-1">
      <h2
        className="min-w-0 text-sm md:text-base font-semibold text-charcoal truncate"
        data-testid="kiro-header-title"
        title={conversationTitle ?? "新对话"}
      >
        {conversationTitle ?? "新对话"}
      </h2>

      <KiroSessionActions variant="workspace" onNewChat={onNewChat} onOpenHistory={onOpenHistory} />
    </div>
  );
}
