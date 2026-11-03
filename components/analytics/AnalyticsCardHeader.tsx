"use client";

import React from "react";
import { cn } from "@/lib/utils";

/**
 * Analytics section header：
 * - md：卡片主标题（15px semibold）——每个圆角区块的标题。
 * - sm：卡片内子分区（13px semibold）——课程投入 / 专注节奏 / 学习前瞻等嵌套块。
 */
export function AnalyticsCardHeader({
  title,
  action,
  className,
  size = "md",
}: {
  title: string;
  action?: React.ReactNode;
  className?: string;
  size?: "md" | "sm";
}) {
  return (
    <div className={cn("flex min-w-0 items-center justify-between gap-3", className)}>
      <h3
        className={cn(
          "min-w-0 truncate font-semibold tracking-[-0.01em] text-charcoal",
          size === "md" ? "text-[15px]" : "text-[13px]"
        )}
      >
        {title}
      </h3>
      {action}
    </div>
  );
}
