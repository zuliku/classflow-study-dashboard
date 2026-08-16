"use client";

import React from "react";
import { cn } from "@/lib/utils";

/**
 * WorkspaceViewBar（App Chrome V2）：workspace 内部视图层的通用 toolbar shell。
 *
 * 职责 ONLY（无任何业务判断）：
 * - full-width workspace-local toolbar（height ≈44–48px）
 * - border-bottom + solid ClassFlow surface（与 WorkspaceHeader 同一视觉语言）
 * - 左右两区：primary（视图/范围切换）+ secondary（筛选/搜索/显示控制）
 * - 响应式：空间不足时自动换行（不裁剪控件）；水平内容由调用方自带滚动语义
 * - 可访问性：语义化 toolbar 容器
 *
 * 业务内容（任务视图/课程筛选等）由调用方以 slot 注入；禁止在 primitive 内写
 * task / course / analytics / timetable 等业务判断。
 */
export function WorkspaceViewBar({
  primary,
  secondary,
  className,
  testid,
}: {
  primary?: React.ReactNode;
  secondary?: React.ReactNode;
  className?: string;
  testid?: string;
}) {
  return (
    <div
      role="toolbar"
      aria-label="工作区视图栏"
      data-testid={testid}
      className={cn(
        "z-20 flex min-h-12 w-full shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line bg-[#F7F5F5] px-4 py-2 md:px-6",
        className
      )}
    >
      {primary ? <div className="flex min-w-0 items-center gap-2">{primary}</div> : null}
      {secondary ? (
        <div className="flex min-w-0 items-center gap-2">{secondary}</div>
      ) : null}
    </div>
  );
}
