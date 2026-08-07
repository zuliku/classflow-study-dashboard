"use client";

import React from "react";
import { cn } from "@/lib/utils";

/**
 * 页面 Tab 切换 wrapper：以 activeTab 为 key，进入时
 * opacity 0→1 + translateY 4px→0（220ms），不做退出动画与左右滑动。
 * className 用于传入页面内容的纵向间距（如 space-y-5），
 * 避免间距挂在 main 上但被本包装层隔断。
 */
export function PageTransition({
  tab,
  className,
  children,
}: {
  tab: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div key={tab} className={cn("ux-page", className)}>
      {children}
    </div>
  );
}
