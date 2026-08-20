"use client";

import React from "react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * WorkspaceInboxButton — App Shell structural action (Top bar).
 * 职责仅：Inbox 图标 + unread 徽标 + 打开 Inbox。 不在按钮内保存 Inbox 数据（unread 由 owner 传入）。
 */
export interface WorkspaceInboxButtonProps {
  unreadCount?: number;
  onClick: () => void;
  className?: string;
}

export function WorkspaceInboxButton({ unreadCount = 0, onClick, className }: WorkspaceInboxButtonProps) {
  const hasUnread = unreadCount > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="workspace-inbox-button"
      aria-label={hasUnread ? `收件箱 ${unreadCount} 条未读` : "收件箱"}
      className={cn(
        "relative inline-flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-lg border font-bold text-xs shrink-0",
        "bg-white border-line text-charcoal hover:bg-alabaster",
        "transition-colors duration-[var(--motion-snap)] ease-[var(--ease-standard)]",
        "focus-visible:outline-2 focus-visible:outline-charcoal/30 focus-visible:outline-offset-2",
        className
      )}
    >
      <Inbox className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span className="hidden md:inline">收件箱</span>
      {hasUnread && (
        <span
          data-testid="workspace-inbox-badge"
          className="min-w-[18px] h-[18px] px-1 rounded-full bg-charcoal text-white text-[10px] font-bold flex items-center justify-center leading-none"
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </button>
  );
}
