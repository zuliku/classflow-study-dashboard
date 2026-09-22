"use client";

import React from "react";
import { cn } from "@/lib/utils";

/**
 * Kiro Inspector — Section 容器（V1）。
 * 单一一级 Surface 内的 flat section：标题 + 可选 action + 内容；不使用 Card 嵌套。
 */
export function KiroInspectorSection({
  title,
  action,
  testId,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <section data-testid={testId} className="px-3 py-3">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <h3 className="text-[11px] font-semibold text-charcoal">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Section 之间的极弱分隔线（Inspector 内部唯一分隔手段） */
export function KiroInspectorDivider() {
  return <div className="h-px bg-line-soft mx-3" aria-hidden="true" />;
}

/** 极弱 empty state（无 Card / 无大图标） */
export function KiroInspectorEmptyState({
  text,
  hint,
  className,
}: {
  text: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("px-0.5 py-1.5", className)}>
      <p className="text-[10px] text-sandrift">{text}</p>
      {hint ? <p className="text-[10px] text-sandrift/80 mt-0.5 leading-relaxed">{hint}</p> : null}
    </div>
  );
}
