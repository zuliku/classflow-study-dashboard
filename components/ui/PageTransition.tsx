"use client";

import React from "react";
import { cn } from "@/lib/utils";

/**
 * 页面 Tab 切换 wrapper：以 activeTab 为 key，进入时 opacity 0→1（180ms，--motion-page）。
 * 仅 opacity-only（无 translateY）：避免动画期 transient scroll overflow / scrollbar 布局抖动，
 * 与 main [scrollbar-gutter:stable] 共同保证切换期间 App Shell / Header 完全稳定。
 * className 仅用于内容布局；不做 Old/New crossfade（避免双挂载复杂度）。
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
