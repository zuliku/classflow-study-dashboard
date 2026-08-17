"use client";

import React from "react";
import { cn } from "@/lib/utils";

/**
 * WorkspaceViewBar（App Chrome V2）：workspace 内部视图层的通用 toolbar shell。
 *
 * 职责 ONLY（无任何业务判断）：
 * - Outer：full-bleed surface（width 100%、border-bottom、solid ClassFlow 背景）
 * - Inner：primary（视图/范围切换）+ secondary（筛选/搜索/显示控制），高度 ≈44–48px，
 *   默认 px-4 md:px-6；innerClassName 提供 bounded content（如 max-w + mx-auto）
 * - 响应式：空间不足时自动换行（不裁剪控件）；水平内容由调用方自带滚动语义
 * - 可访问性：语义化 toolbar 容器
 *
 * 业务内容（任务视图/课程筛选等）由调用方以 slot 注入；禁止在 primitive 内写业务判断。
 * 不传 innerClassName 时默认几何与 V2 完全一致（无 feature variant）。
 */
export function WorkspaceViewBar({
  primary,
  secondary,
  className,
  innerClassName,
  testid,
}: {
  primary?: React.ReactNode;
  secondary?: React.ReactNode;
  className?: string;
  /** Inner content 布局附加类（如 max-w + mx-auto）；不改 Outer shell 几何 */
  innerClassName?: string;
  testid?: string;
}) {
  return (
    <div
      role="toolbar"
      aria-label="工作区视图栏"
      data-testid={testid}
      className={cn("z-20 w-full shrink-0 border-b border-line bg-[#F7F5F5]", className)}
    >
      <div
        className={cn(
          "flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2 md:px-6",
          innerClassName
        )}
      >
        {primary ? <div className="flex min-w-0 items-center gap-2">{primary}</div> : null}
        {secondary ? (
          <div className="flex min-w-0 items-center gap-2">{secondary}</div>
        ) : null}
      </div>
    </div>
  );
}
