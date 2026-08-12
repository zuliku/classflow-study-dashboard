"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { WorkspaceSearchButton } from "@/components/layout/WorkspaceSearchButton";

/**
 * Workspace Header（UI Productization Task 1）：全站统一 Workspace 顶部结构。
 *
 * 结构：Title / Context（左） + Actions / Primary / Search（右）。
 * 视觉：非 Card、无 shadow-subtle、subtle bottom border、暖灰背景、sticky top-0。
 * 无 feature variant（禁止 variant="tasks" 等）；页面业务 Context 由页面自身计算后传入。
 * 不建立 Header Registry / Context slot store；className 只用于布局对齐。
 */
export interface WorkspaceHeaderProps {
  title: React.ReactNode;
  context?: React.ReactNode;
  primaryAction?: React.ReactNode;
  actions?: React.ReactNode;
  hideSearch?: boolean;
  sticky?: boolean;
  className?: string;
}

export function WorkspaceHeader({
  title,
  context,
  primaryAction,
  actions,
  hideSearch,
  sticky,
  className,
}: WorkspaceHeaderProps) {
  return (
    <header
      className={cn(
        "z-20 flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-[#F7F5F5] py-2.5",
        sticky && "sticky top-0",
        className
      )}
    >
      <div className="min-w-0">
        <h1 className="truncate text-base font-semibold tracking-tight text-charcoal md:text-lg">
          {title}
        </h1>
        {context ? (
          <div className="mt-0.5 truncate text-[11px] text-sandrift md:text-xs">{context}</div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
        {actions}
        {primaryAction}
        {!hideSearch ? <WorkspaceSearchButton /> : null}
      </div>
    </header>
  );
}
