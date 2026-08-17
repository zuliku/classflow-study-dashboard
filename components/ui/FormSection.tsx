"use client";

import React from "react";

/**
 * Modal 表单分节（Task 3A Creation Flows）：
 * 节标题 + 右侧动作 + 下方内容；节与节之间用 divider 分隔，不套独立 Card。
 */
export function FormSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2.5 pb-4 border-b border-line-soft last:border-0 last:pb-0">
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-bold text-sandrift tracking-wide">{title}</h4>
        {action}
      </div>
      {children}
    </section>
  );
}
