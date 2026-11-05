"use client";

import React from "react";
import { X } from "lucide-react";
import { KiroMark } from "@/components/kiro/KiroHeader";
import { MINI_CAPSULE_SIZE, type MiniChatPhase } from "@/lib/ai/miniChat/protocol";
import { cn } from "@/lib/utils";

/**
 * Mini 胶囊态：72×72 常驻标记。
 *
 * 视觉只保留一层表面：不再有「窗口 → 内层卡片 → Logo 按钮」三层嵌套；
 * 空闲时只有 Logo，忙碌/等待时出现一个状态点，未读时出现一个计数。
 * 主体仍是原生拖动区，只有中心 44px 命中区可点击展开。
 */
export function MiniChatCapsule({
  statusLabel,
  phase,
  busy,
  unread,
  onExpand,
  onHide,
}: {
  statusLabel: string;
  phase: MiniChatPhase;
  busy: boolean;
  unread: number;
  onExpand: () => void;
  onHide: () => void;
}) {
  const showStatus = busy || !!statusLabel || phase === "waiting-approval" || phase === "error";
  return (
    <div
      className="mini-drag-region group relative select-none overflow-hidden rounded-[20px] bg-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]"
      style={{ width: MINI_CAPSULE_SIZE, height: MINI_CAPSULE_SIZE }}
      data-testid="kiro-mini-capsule"
      aria-label={statusLabel ? `Kiro Mini，${statusLabel}` : "Kiro Mini"}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-line-soft"
      />

      <button
        type="button"
        className="mini-no-drag absolute left-1/2 top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-charcoal/15"
        aria-label="展开 Kiro Mini"
        onClick={onExpand}
        onDoubleClick={onExpand}
      >
        <KiroMark
          size="md"
          className="transition-transform duration-[var(--motion-fast)] ease-[var(--ease-standard)] group-hover:scale-105"
        />
      </button>

      {showStatus && (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute bottom-[13px] right-[13px] h-1.5 w-1.5 rounded-full transition-colors",
            phase === "error"
              ? "bg-danger"
              : phase === "waiting-approval"
                ? "bg-warning"
                : busy
                  ? "bg-charcoal animate-pulse"
                  : "bg-satin-grey/80"
          )}
        />
      )}

      {unread > 0 && (
        <span
          data-testid="kiro-mini-capsule-unread"
          className="pointer-events-none absolute right-2.5 top-2.5 min-w-[14px] rounded-full bg-charcoal px-[3px] text-center text-[8px] font-bold leading-[14px] text-white animate-enter"
        >
          {unread > 9 ? "9+" : unread}
        </span>
      )}

      <button
        type="button"
        aria-label="隐藏迷你窗"
        className="mini-no-drag pointer-events-none absolute left-0.5 top-0.5 flex h-7 w-7 items-center justify-center rounded-full text-satin-grey opacity-0 transition-opacity duration-[var(--motion-fast)] hover:text-charcoal focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
        onClick={onHide}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
