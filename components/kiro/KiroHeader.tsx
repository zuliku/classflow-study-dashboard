"use client";

import React from "react";
import { PanelRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { KiroSessionActions } from "@/components/kiro/KiroSessionActions";
import { KiroRecentArtifactsPopover } from "@/components/kiro/computer/KiroRecentArtifactsPopover";
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
 * 右侧：Inspector 开关（xl+）+ 最近文件 fallback（<xl）+ 会话级操作（Share / More）。
 */
export function KiroHeader({
  onNewChat,
  onOpenHistory,
  inspectorOpen = false,
  onToggleInspector,
}: {
  onNewChat: () => void;
  onOpenHistory: () => void;
  /** Kiro Inspector 当前是否打开（xl+ 才渲染开关） */
  inspectorOpen?: boolean;
  onToggleInspector?: () => void;
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

      <div className="flex items-center gap-1.5 shrink-0">
        {/* Kiro Inspector 开关（xl+；参考 Codex 的右侧面板 toggle） */}
        {onToggleInspector && (
          <button
            type="button"
            onClick={onToggleInspector}
            aria-label={inspectorOpen ? "收起输出与来源" : "打开输出与来源"}
            aria-expanded={inspectorOpen}
            aria-keyshortcuts="Control+I Meta+I"
            title="输出与来源 · Ctrl+I"
            data-testid="kiro-inspector-toggle"
            className={cn(
              "hidden xl:flex w-8 h-8 md:w-9 md:h-9 items-center justify-center rounded-xl transition-colors",
              inspectorOpen
                ? "bg-alabaster text-charcoal"
                : "text-sandrift hover:bg-alabaster hover:text-charcoal"
            )}
          >
            <PanelRight className="w-4 h-4" />
          </button>
        )}
        {/* V2 Part 3：最近文件（仅 Workspace；Sidecar 不挂载）。
            Kiro Inspector P2：xl+ 由右侧 Inspector Outputs 承担 → Header 入口隐藏；<xl 保留为 fallback。 */}
        <span className="xl:hidden">
          <KiroRecentArtifactsPopover />
        </span>
        <KiroSessionActions variant="workspace" onNewChat={onNewChat} onOpenHistory={onOpenHistory} />
      </div>
    </div>
  );
}
