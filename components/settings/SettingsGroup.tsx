"use client";

import React from "react";

/**
 * SettingsGroup（Settings V3 Task 1）：
 * 中圆角（rounded-xl）分组容器，承载 SettingRow 列表（行间由 SettingRow 自带 divider 分隔）。
 * 普通设置不一项一张 card；只有真正需要聚合/状态展示的区域才用独立 Card。
 * 可省略 title（SettingsSection 已提供页级标题时）。
 * action：标题右侧的全局操作区（如「添加位置」）；窄屏可自然换行；不改变 body padding。
 * description：标题下方 subtle text；同时提供 title+description 时仍显示（修复假 API）。
 * contentClassName：可覆盖 bordered body 的内边距（如 Extensions 的 px-4 py-4）；默认 px-4 保持 SettingRow 几何。
 */
export function SettingsGroup({
  title,
  description,
  action,
  children,
  contentClassName,
  className,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  contentClassName?: string;
  className?: string;
}) {
  return (
    <section className={className ? `space-y-2 ${className}` : "space-y-2"}>
      {title && (
        <div className="flex items-center justify-between gap-2 flex-wrap min-w-0">
          <h4 className="text-[10px] font-bold text-sandrift uppercase tracking-wider leading-snug px-0.5">
            {title}
          </h4>
          {action && <div className="shrink-0 px-0.5">{action}</div>}
        </div>
      )}
      {description && (
        <p className="text-[10px] text-sandrift px-0.5 leading-relaxed">{description}</p>
      )}
      <div className={`rounded-xl border border-line bg-surface overflow-hidden ${contentClassName ?? "px-4"}`}>
        {children}
      </div>
    </section>
  );
}
