"use client";

import React from "react";
import { KiroLogoIcon } from "@/components/kiro/KiroLogo";
import { cn } from "@/lib/utils";

/**
 * Kiro 流光入口（与左侧栏 Featured Entry 同一视觉语言）：
 * 1px 彩色流光环（kiro-ring + kiro-featured-flow）+ 浅色底。
 * - KiroFlowButton：完整按钮（Ask Kiro / 导航入口）
 * - KiroFlowIcon：仅图标环（BottomNav / 命令中心列表项）
 */

export function KiroFlowButton({
  icon: Icon,
  label,
  onClick,
  size = "md",
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  /** sm：h-8 紧凑（Ask Kiro 小按钮）；md：h-10（主入口） */
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative rounded-lg overflow-hidden group text-left transition-colors duration-[var(--motion-base)]",
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute -inset-1/2 kiro-ring kiro-featured-flow pointer-events-none",
          "opacity-80 transition-opacity duration-[var(--motion-fast)]",
          "group-hover:opacity-100 group-focus-visible:opacity-100"
        )}
      />
      <span
        className={cn(
          "relative m-[1.5px] w-[calc(100%-3px)] bg-[#F7F5F5]",
          "flex items-center justify-center gap-1.5 text-[11px] font-bold text-charcoal",
          size === "sm" ? "h-[calc(100%-3px)] px-2.5 rounded-[7px]" : "h-[calc(100%-3px)] px-3 rounded-[10px]"
        )}
      >
        <Icon className={size === "sm" ? "w-3.5 h-3.5 shrink-0" : "w-4 h-4 shrink-0"} />
        <span className="truncate">{label}</span>
      </span>
    </button>
  );
}

export function KiroFlowIcon({
  size = "md",
  className,
}: {
  /** sm：20px（命令中心行）；md：28px（BottomNav 图标槽） */
  size?: "sm" | "md";
  className?: string;
}) {
  const box = size === "sm" ? "w-5 h-5" : "w-7 h-7";
  const ring = size === "sm" ? "rounded-md" : "rounded-lg";
  const inner = size === "sm" ? "rounded-[5px]" : "rounded-[9px]";
  const iconCls = size === "sm" ? "w-3 h-3" : "w-4 h-4";
  return (
    <span className={cn("relative inline-flex overflow-hidden shrink-0", box, ring, className)} aria-hidden="true">
      <span className={cn("absolute -inset-1/2 kiro-ring kiro-featured-flow pointer-events-none", "opacity-80")} />
      <span className={cn("relative m-[1.5px] w-[calc(100%-3px)] h-[calc(100%-3px)] bg-[#F7F5F5] flex items-center justify-center", inner)}>
        <KiroLogoIcon className={iconCls} />
      </span>
    </span>
  );
}

