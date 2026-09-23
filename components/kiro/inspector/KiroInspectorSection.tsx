"use client";

import React from "react";
import { cn } from "@/lib/utils";

/**
 * Kiro Inspector — Section 容器（V1.2，Codex-style 层级）。
 *
 * 层级契约：
 * - Section header：11px semibold charcoal + 可选计数 pill（alabaster）+ 可选 action；底部 hairline 分隔
 * - 内容：flat rows（无 Card 嵌套）；section 之间由 hairline 分隔
 * - 单一一级 Surface 内不出现第二层边框
 */
export function KiroInspectorSection({
  title,
  count,
  action,
  testId,
  children,
}: {
  title: string;
  /** 计数 pill（0 / undefined → 不显示） */
  count?: number;
  action?: React.ReactNode;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <section data-testid={testId}>
      <header
        data-testid="kiro-inspector-section-header"
        className="flex items-center gap-2 px-3 pt-3 pb-2"
      >
        <h3 className="text-[11px] font-semibold tracking-[0.01em] text-charcoal">{title}</h3>
        {typeof count === "number" && count > 0 && (
          <span
            data-testid="kiro-inspector-section-count"
            className="text-[9px] font-bold leading-none text-satin-grey bg-alabaster rounded-full px-1.5 py-0.5"
          >
            {count}
          </span>
        )}
        <span className="flex-1" aria-hidden="true" />
        {action}
      </header>
      <div className="px-2 pb-2.5">{children}</div>
    </section>
  );
}

/** Section 之间的 hairline（Inspector 内部唯一分隔手段） */
export function KiroInspectorDivider() {
  return <div className="h-px bg-line-soft" aria-hidden="true" />;
}

/** 极弱 empty state（无 Card / 无大图标；可选 12px 前置图标） */
export function KiroInspectorEmptyState({
  text,
  hint,
  icon,
  className,
}: {
  text: string;
  hint?: string;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start gap-2 px-1.5 py-1.5", className)}>
      {icon ? <span className="mt-[1px] shrink-0 text-sandrift/70">{icon}</span> : null}
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-satin-grey">{text}</p>
        {hint ? <p className="text-[10px] text-sandrift/90 mt-0.5 leading-relaxed">{hint}</p> : null}
      </div>
    </div>
  );
}

/** Inspector row 外壳（统一 32px 行高密度 + soft hover + 行内 actions hover 显现） */
export function KiroInspectorRow({
  icon,
  testId,
  className,
  onClick,
  ariaLabel,
  ariaCurrent,
  disabled,
  children,
  actions,
}: {
  icon: React.ReactNode;
  testId?: string;
  className?: string;
  onClick?: () => void;
  ariaLabel?: string;
  ariaCurrent?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const content = (
    <>
      <span className="mt-[1px] shrink-0 text-sandrift">{icon}</span>
      <span className="min-w-0 flex-1 text-left">{children}</span>
      {actions ? (
        <span className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 transition-opacity">
          {actions}
        </span>
      ) : null}
    </>
  );

  if (onClick) {
    return (
      <div className={cn("group/row flex items-start gap-2 rounded-lg hover:bg-alabaster/70 transition-colors", className)}>
        <button
          type="button"
          onClick={onClick}
          aria-label={ariaLabel}
          aria-current={ariaCurrent ? "true" : undefined}
          disabled={disabled}
          data-testid={testId}
          className="flex min-w-0 flex-1 items-start gap-2 px-2 py-1.5 text-left disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {content}
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid={testId}
      className={cn("group/row flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-alabaster/60 transition-colors", className)}
    >
      {content}
    </div>
  );
}
