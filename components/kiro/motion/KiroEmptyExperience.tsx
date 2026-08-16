"use client";

import React, { useEffect, useRef } from "react";
import { usePresence } from "@/lib/usePresence";
import { KiroEmptyState } from "@/components/kiro/KiroEmptyState";
import { cn } from "@/lib/utils";

/**
 * Kiro Motion System V1 —— Empty Experience（Contextual Handoff）。
 * - open = 当前没有消息；playIntro = 本轮 empty generation 的 intro claim 成功
 * - conversation 出现时：Empty 立即 semantic close（aria-hidden + inert + pointer-events-none），
 *   视觉退场 ~150ms（.kiro-empty-exit）后 unmount；Conversation 不等退场
 * - 完全不含 streaming / runtime 逻辑（只有展示层 choreography）
 */
export function KiroEmptyExperience({
  open,
  compact,
  playIntro,
  onSuggestion,
  contextSuggestions,
}: {
  open: boolean;
  compact: boolean;
  playIntro: boolean;
  onSuggestion: (text: string) => void;
  contextSuggestions?: React.ReactNode;
}) {
  const { mounted, visible } = usePresence(open, 160);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // React 18 types 无 inert prop → 运行时属性（仓库既有模式）
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (open) el.removeAttribute("inert");
    else el.setAttribute("inert", "");
  }, [open]);

  if (!mounted) return null;

  return (
    <div
      ref={rootRef}
      data-testid="kiro-empty-experience"
      aria-hidden={!open}
      className={cn(
        "absolute inset-0 z-10 flex min-h-0 flex-col",
        // semantic close：立即不可交互；视觉退场由 kiro-empty-exit 承担（~150ms）
        !open && "pointer-events-none",
        open ? (visible ? "opacity-100" : "opacity-0") : "kiro-empty-exit"
      )}
    >
      <KiroEmptyState
        onSuggestion={onSuggestion}
        compact={compact}
        contextSuggestions={contextSuggestions}
        playIntro={playIntro}
      />
    </div>
  );
}
