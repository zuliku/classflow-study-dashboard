"use client";

import React from "react";
import { X } from "lucide-react";
import { KiroMark } from "@/components/kiro/KiroHeader";
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
  busy,
  unread,
  onExpand,
  onHide,
}: {
  statusLabel: string;
  busy: boolean;
  unread: number;
  onExpand: () => void;
  onHide: () => void;
}) {
  const showStatus = busy || !!statusLabel;
  return (
    <div
      className="mini-drag-region group relative h-screen w-screen select-none overflow-hidden rounded-[20px] bg-surface"
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
            busy ? "bg-charcoal animate-pulse" : "bg-sandrift/80"
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
        className="mini-no-drag pointer-events-none absolute left-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full text-sandrift opacity-0 transition-opacity duration-[var(--motion-fast)] hover:text-charcoal focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
        onClick={onHide}
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}
