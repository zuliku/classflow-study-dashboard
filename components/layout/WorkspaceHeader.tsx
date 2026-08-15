"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { WorkspaceSearchButton } from "@/components/layout/WorkspaceSearchButton";

/**
 * Workspace Header（App Shell Structural Header）：Main Workspace 的固定结构层顶栏。
 *
 * 结构：Title / Context（左） + Actions / Primary / Search（右）。
 * 几何：width 100%、shrink-0、solid 背景（不透内容）、border-bottom、
 *       no margin / no outer radius / no shadow、sticky top-0（main 为 scroll container）、
 *       z-20（普通内容 < Header < Popover z-40 < Dialog/Overlay z-50）。
 * Header surface full bleed；内部自带 px-4 md:px-6，与下方 page content 左右内容线对齐，
 * 不依赖 page padding 制造 gutter。
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
        "z-20 flex min-h-14 w-full shrink-0 items-center justify-between gap-3 border-b border-line bg-[#F7F5F5] px-4 py-2.5 md:min-h-16 md:px-6 md:py-2",
        sticky && "sticky top-0",
        className
      )}
    >
      <div className="min-w-0">
        <h1 className="truncate text-lg font-semibold tracking-tight text-charcoal">
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
