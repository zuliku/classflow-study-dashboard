"use client";

import React from "react";
import { ChevronDown, Minus, Plus, X } from "lucide-react";
import { KiroMark } from "@/components/kiro/KiroHeader";

export function MiniChatHeader({
  title,
  busy,
  unread,
  menuOpen,
  onCollapse,
  onHide,
  onNewChat,
  onOpenConversations,
}: {
  title: string;
  busy: boolean;
  unread: number;
  menuOpen: boolean;
  onCollapse: () => void;
  onHide: () => void;
  onNewChat: () => void;
  onOpenConversations: () => void;
}) {
  return (
    <header
      className="mini-drag-region flex h-11 shrink-0 items-center gap-1 border-b border-line bg-surface pl-2.5 pr-1 select-none"
      data-testid="kiro-mini-header"
    >
      <KiroMark size="sm" />
      <button
        type="button"
        onClick={onOpenConversations}
        className="mini-no-drag flex h-8 min-w-0 flex-1 items-center gap-1 rounded-lg px-1.5 text-left transition-colors hover:bg-alabaster/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-charcoal/15"
        aria-label="切换对话"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <span className="truncate text-[12px] font-bold text-charcoal">{title || "Kiro Mini"}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {busy && (
            <span
              className="h-1.5 w-1.5 rounded-full bg-charcoal animate-pulse"
              aria-hidden="true"
            />
          )}
          {unread > 0 && (
            <span
              className="h-1.5 w-1.5 rounded-full bg-charcoal"
              aria-label={`${unread} 条未读`}
            />
          )}
        </span>
        <ChevronDown className="h-3 w-3 shrink-0 text-satin-grey" aria-hidden="true" />
      </button>

      <button
        type="button"
        aria-label="新对话"
        className="mini-no-drag flex h-8 w-8 items-center justify-center rounded-lg text-satin-grey transition-colors hover:bg-alabaster hover:text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-charcoal/15"
        onClick={onNewChat}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-label="收起迷你窗"
        className="mini-no-drag flex h-8 w-8 items-center justify-center rounded-lg text-satin-grey transition-colors hover:bg-alabaster hover:text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-charcoal/15"
        onClick={onCollapse}
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-label="隐藏迷你窗"
        className="mini-no-drag flex h-8 w-8 items-center justify-center rounded-lg text-satin-grey transition-colors hover:bg-alabaster hover:text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-charcoal/15"
        onClick={onHide}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </header>
  );
}
