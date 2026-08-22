"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { WorkspaceSearchButton } from "@/components/layout/WorkspaceSearchButton";

/**
 * Workspace Header（App Shell Structural Header）：Main Workspace 的固定结构层顶栏。
 *
 * 结构：Outer（full-bleed shell：width 100%、solid 背景、border-bottom、可选 sticky）
 *       + Inner（flex：Title / Context 左 + Actions / Primary / Search 右）。
 * 几何：Inner 默认 workspace-gutter（px-4 / md:px-6，单一来源见 globals.css）+ min-h-14 md:min-h-16 + py-2.5/2；
 *       innerClassName 提供 bounded content 能力（如 Analytics 的 max-w-[1500px] mx-auto），
 *       不传时默认页面视觉与既有完全一致（无 feature variant）。
 * no margin / no outer radius / no shadow；z-20（普通内容 < Header < Popover z-40 < Dialog/Overlay z-50）。
 */
export interface WorkspaceHeaderProps {
  title: React.ReactNode;
  context?: React.ReactNode;
  primaryAction?: React.ReactNode;
  actions?: React.ReactNode;
  hideSearch?: boolean;
  sticky?: boolean;
  className?: string;
  /** Inner content 布局附加类（如 max-w + mx-auto）；不改 Outer shell 几何 */
  innerClassName?: string;
}

export function WorkspaceHeader({
  title,
  context,
  primaryAction,
  actions,
  hideSearch,
  sticky,
  className,
  innerClassName,
}: WorkspaceHeaderProps) {
  return (
    <header
      className={cn(
        "z-20 w-full shrink-0 border-b border-line bg-background",
        sticky && "sticky top-0",
        className
      )}
    >
      <div
        className={cn(
          // workspace-gutter：与页面 body 左右 gutter 单一来源（见 globals.css）
          "workspace-gutter flex min-h-14 items-center justify-between gap-3 py-2.5 md:min-h-16 md:py-2",
          innerClassName
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
      </div>
    </header>
  );
}
