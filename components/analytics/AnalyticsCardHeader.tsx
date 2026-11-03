"use client";

import React from "react";
import { cn } from "@/lib/utils";

/**
 * Analytics section header（产品化 V2）：
 * - 只保留标题 + 可选右侧行动；不再渲染小类目 eyebrow / 装饰图标。
 * - 标题层级与 Workspace 内文一致（15px semibold），靠留白与分隔线组织层级，而不是卡片。
 */
export function AnalyticsCardHeader({
  title,
  action,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center justify-between gap-3", className)}>
      <h3 className="min-w-0 truncate text-[15px] font-semibold tracking-[-0.01em] text-charcoal">
        {title}
      </h3>
      {action}
    </div>
  );
}
