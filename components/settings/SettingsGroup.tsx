"use client";

import React from "react";

/**
 * SettingsGroup（Settings V3 Task 1）：
 * 中圆角（rounded-xl）分组容器，承载 SettingRow 列表（行间由 SettingRow 自带 divider 分隔）。
 * 普通设置不一项一张 card；只有真正需要聚合/状态展示的区域才用独立 Card。
 * 可省略 title（SettingsSection 已提供页级标题时）。
 */
export function SettingsGroup({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      {title && (
        <h4 className="text-[10px] font-bold text-sandrift uppercase tracking-wider px-0.5">
          {title}
        </h4>
      )}
      {description && !title && (
        <p className="text-[10px] text-sandrift px-0.5">{description}</p>
      )}
      <div className="rounded-xl border border-line bg-surface overflow-hidden px-4">
        {children}
      </div>
    </section>
  );
}
