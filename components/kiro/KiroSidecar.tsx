"use client";

import React from "react";
import { X, Expand } from "lucide-react";
import { useKiroSession } from "@/components/kiro/KiroSessionProvider";
import { KiroChatSurface } from "@/components/kiro/KiroChatSurface";
import { KiroMark } from "@/components/kiro/KiroHeader";
import { KiroSessionActions } from "@/components/kiro/KiroSessionActions";
import { usePresence } from "@/lib/usePresence";
import { cn } from "@/lib/utils";

/**
 * Kiro Sidecar：贯穿 ClassFlow 的 AI Agent 入口。
 * 与 KiroWorkspace 共享同一个 Persistent Session（同一 Runtime / 附件 / Undo）。
 * Header 层级：会话级（Share / More）+ Panel 级（Expand / Close）；新对话在 More 内。
 * 具体 Context 由 Composer 上方的 ContextBar 展示（不重复）。
 * Responsive：
 *  ≥1536  Docked（sticky 整屏 AI Panel，独立滚动，Composer 固定底部）
 *  1280–1535  Right Overlay（border-left + shadow，不压窄课表）
 *  768–1279  Right Side Sheet
 *  <768  Full-screen
 */
export function KiroSidecar({ open }: { open: boolean }) {
  const session = useKiroSession();
  const { closeSidecar, expandSidecar } = session;
  const { mounted, visible } = usePresence(open, 160);

  if (!mounted) return null;

  return (
    <div
      data-testid="kiro-sidecar"
      data-state={open ? "open" : "closed"}
      aria-hidden={!open}
      className={cn(
        cnSidecar(),
        "transition-[opacity,transform] ease-[var(--ease-standard)]",
        visible
          ? "duration-[var(--motion-panel)] translate-x-0 opacity-100"
          : "duration-[160ms] translate-x-2 opacity-0 pointer-events-none",
        "2xl:translate-x-0"
      )}
    >
      {/* Compact Header：品牌 + 会话级操作；md+ 与全局 Header border 对齐（min-h-16） */}
      <div className="shrink-0 px-3 py-3 md:min-h-16 border-b border-line bg-[#F7F5F5] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <KiroMark size="sm" />
          <h2 className="text-sm font-bold text-charcoal" data-testid="kiro-sidecar-title">
            Kiro
          </h2>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <KiroSessionActions variant="sidecar" onExpand={expandSidecar} />
          <button
            onClick={expandSidecar}
            aria-label="展开到 Kiro 工作区"
            title="展开"
            className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center rounded-xl text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
          >
            <Expand className="w-4 h-4" />
          </button>
          <button
            onClick={closeSidecar}
            aria-label="关闭 Kiro"
            title="关闭"
            className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center rounded-xl text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
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
    // ≥1536：Docked（约 424px，sticky 整屏 AI Panel：跟随 viewport 高度，内部独立滚动）
    "2xl:w-[424px] 2xl:sticky 2xl:top-0 2xl:h-dvh 2xl:self-start 2xl:z-auto 2xl:shadow-none",
  ].join(" ");
}
