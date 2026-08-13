"use client";

import React from "react";

/**
 * SettingsGroup（Settings V3 Task 1）：
 * 中圆角（rounded-xl）分组容器，承载 SettingRow 列表（行间由 SettingRow 自带 divider 分隔）。
 * 普通设置不一项一张 card；只有真正需要聚合/状态展示的区域才用独立 Card。
 * 可省略 title（SettingsSection 已提供页级标题时）。
 * action：标题右侧的全局操作区（如「添加位置」）；窄屏可自然换行；不改变 body padding。
 */
export function SettingsGroup({
  title,
  description,
  action,
  children,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      {title && (
        <div className="flex items-center justify-between gap-2 flex-wrap min-w-0">
          <h4 className="text-[10px] font-bold text-sandrift uppercase tracking-wider leading-snug px-0.5">
            {title}
          </h4>
          {action && <div className="shrink-0 px-0.5">{action}</div>}
        </div>
      )}
      {description && !title && (
        <p className="text-[10px] text-sandrift px-0.5 leading-relaxed">{description}</p>
      )}
      <div className="rounded-xl border border-line bg-surface overflow-hidden px-4">
        {children}
      </div>
    </section>
  );
}
