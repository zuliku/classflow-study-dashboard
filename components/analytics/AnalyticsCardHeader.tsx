"use client";

import React from "react";

/**
 * 洞察卡片统一头（Phase 2 产品化）：
 * eyebrow 小类目 + 标题行（可选图标/右侧行动），全卡同高同式。
 * 只改表达层：标题文字/testid/数据口径不动；配对行等高由 grid stretch 保证，
 * 头部统一后两两等高自然成立。
 */
export function AnalyticsCardHeader({
  eyebrow,
  title,
  icon,
  action,
}: {
  eyebrow: string;
  title: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[10px] font-bold tracking-[0.04em] text-sandrift">{eyebrow}</p>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-1.5 text-sm font-bold text-charcoal">
          {icon}
          <span>{title}</span>
        </h3>
        {action}
      </div>
    </div>
  );
}
