"use client";

import React from "react";
import { X } from "lucide-react";
import { KiroMark } from "@/components/kiro/KiroHeader";
import { cn } from "@/lib/utils";

/**
 * Mini 胶囊态：72×72 常驻悬浮标记。
 * - 空白区域是原生拖动区；中心按钮展开，右上角按钮隐藏；
 * - 状态点 + 未读计数；reduced-motion 下不播放呼吸。
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
  return (
    <div
      className="mini-drag-region relative h-screen w-screen select-none p-1"
      data-testid="kiro-mini-capsule"
      aria-label={statusLabel ? `Kiro Mini，${statusLabel}` : "Kiro Mini"}
    >
      <div className="group relative flex h-full w-full items-center justify-center rounded-[20px] border border-line bg-surface shadow-card">
        <button
          type="button"
          className="mini-no-drag flex h-12 w-12 items-center justify-center rounded-2xl hover:bg-alabaster transition-colors"
          aria-label="展开 Kiro Mini"
          onClick={onExpand}
          onDoubleClick={onExpand}
        >
          <KiroMark size="sm" />
        </button>

        <span
          aria-hidden="true"
          className={cn(
            "absolute bottom-2 right-2 h-2 w-2 rounded-full border border-surface",
            busy ? "bg-charcoal animate-pulse" : statusLabel ? "bg-sandrift" : "bg-line-strong"
          )}
        />

        {unread > 0 && (
          <span
            data-testid="kiro-mini-capsule-unread"
            className="absolute right-1.5 top-1.5 min-w-4 rounded-full bg-charcoal px-1 text-center text-[9px] font-bold leading-4 text-white kiro-status-swap"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}

        <button
          type="button"
          aria-label="隐藏迷你窗"
          className="mini-no-drag pointer-events-none absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full text-sandrift opacity-0 hover:bg-alabaster hover:text-charcoal focus:pointer-events-auto focus:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
          onClick={onHide}
        >
          <X className="h-2.5 w-2.5" />
        </button>
      </div>
    </div>
  );
}
