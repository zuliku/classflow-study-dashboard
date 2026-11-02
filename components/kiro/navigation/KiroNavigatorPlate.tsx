"use client";

import React from "react";
import { KiroLogoIcon } from "@/components/kiro/KiroLogo";
import { kiroRuntimeStatusAriaLabel, type KiroRuntimeStatus } from "@/lib/ai/ui/kiroRuntimeStatus";
import { cn } from "@/lib/utils";

/**
 * Kiro Navigator — Soft Plate（品牌 perimeter）。
 * 与 Kiro Rail Runtime Status V1 同一 CSS 契约：
 * - data-kiro-status：Agent Runtime 状态（唯一 Motion 来源；CSS .kiro-rail-plate[data-kiro-status]）
 * - data-emphasized：Navigation emphasis（expanded / current 的视觉权重；与 Runtime 状态解耦）
 */
export function KiroNavigatorPlate({
  size = "md",
  status,
  emphasized,
  className,
}: {
  size?: "sm" | "md";
  status: KiroRuntimeStatus;
  emphasized?: boolean;
  className?: string;
}) {
  const box = size === "sm" ? "w-8 h-8" : "w-10 h-10";
  const logo = size === "sm" ? "w-[18px] h-[18px]" : "w-6 h-6";
  return (
    <span
      data-kiro-status={status}
      data-emphasized={emphasized || undefined}
      className={cn(
        "relative inline-flex items-center justify-center rounded-xl overflow-hidden kiro-rail-plate",
        box,
        className
      )}
      aria-hidden="true"
    >
      <span className="absolute inset-0 rounded-xl kiro-ring" />
      <span className="relative w-full h-full rounded-[11px] bg-surface border border-line-soft flex items-center justify-center">
        <KiroLogoIcon className={cn(logo, "relative")} />
      </span>
    </span>
  );
}
