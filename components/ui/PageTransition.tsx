"use client";

import React from "react";

/**
 * 页面 Tab 切换 wrapper：以 activeTab 为 key，进入时
 * opacity 0→1 + translateY 4px→0（220ms），不做退出动画与左右滑动。
 */
export function PageTransition({ tab, children }: { tab: string; children: React.ReactNode }) {
  return (
    <div key={tab} className="ux-page">
      {children}
    </div>
  );
}
