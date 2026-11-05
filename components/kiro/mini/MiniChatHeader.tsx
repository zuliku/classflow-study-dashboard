"use client";

import React from "react";
import { ChevronDown, Minus, Pin, PinOff, Plus, X } from "lucide-react";
import { KiroMark } from "@/components/kiro/KiroHeader";
import { cn } from "@/lib/utils";

export function MiniChatHeader({
  title,
  statusLabel,
  statusDetail,
  busy,
  unread,
  onTop,
  onPin,
  onCollapse,
  onHide,
  onNewChat,
  onOpenConversations,
}: {
  title: string;
  statusLabel: string;
  statusDetail?: string;
  busy: boolean;
  unread: number;
  onTop: boolean;
  onPin: () => void;
  onCollapse: () => void;
  onHide: () => void;
  onNewChat: () => void;
  onOpenConversations: () => void;
}) {
  return (
    <header
      className="mini-drag-region flex h-11 shrink-0 items-center gap-1.5 border-b border-line bg-surface pl-2.5 pr-1 select-none"
      data-testid="kiro-mini-header"
    >
      <KiroMark size="sm" />
      <button
        type="button"
        onClick={onOpenConversations}
        className="mini-no-drag flex min-w-0 flex-1 items-center gap-1 rounded-lg px-1 py-0.5 text-left hover:bg-alabaster/60"
        aria-label="切换对话"
      >
        <span className="truncate text-[12px] font-bold text-charcoal">{title || "Kiro Mini"}</span>
        {unread > 0 && (
          <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-charcoal" aria-label={`${unread} 条未读`} />
        )}
        <ChevronDown className="h-3 w-3 shrink-0 text-sandrift" aria-hidden="true" />
      </button>

      {busy && statusLabel && (
        <span
          className="flex min-w-0 shrink-0 items-center gap-1 text-[10px] font-semibold text-sandrift"
          data-testid="kiro-mini-status"
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-charcoal animate-pulse" aria-hidden="true" />
          <span key={statusLabel} className="truncate max-w-[120px] kiro-status-swap">
            {statusLabel}
          </span>
          {statusDetail && <span className="shrink-0 tabular-nums text-sandrift">{statusDetail}</span>}
        </span>
      )}

      <button
        type="button"
        aria-label="新对话"
        className="mini-no-drag flex h-7 w-7 items-center justify-center rounded-lg text-sandrift transition-colors hover:bg-alabaster hover:text-charcoal"
        onClick={onNewChat}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-label={onTop ? "取消置顶" : "置顶显示"}
        className={cn(
          "mini-no-drag flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-alabaster hover:text-charcoal",
          onTop ? "text-charcoal" : "text-sandrift"
        )}
        onClick={onPin}
      >
        <span key={String(onTop)} className="inline-flex kiro-status-swap">
          {onTop ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
        </span>
      </button>
      <button
        type="button"
        aria-label="收起迷你窗"
        className="mini-no-drag flex h-7 w-7 items-center justify-center rounded-lg text-sandrift transition-colors hover:bg-alabaster hover:text-charcoal"
        onClick={onCollapse}
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-label="隐藏迷你窗"
        className="mini-no-drag flex h-7 w-7 items-center justify-center rounded-lg text-sandrift transition-colors hover:bg-alabaster hover:text-charcoal"
        onClick={onHide}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </header>
  );
}
