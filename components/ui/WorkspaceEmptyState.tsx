"use client";

import React from "react";
import { cn } from "@/lib/utils";

/**
 * WorkspaceEmptyState（UI Productization V2.3）：top-level zero-data empty 的统一 Surface。
 *
 * 适用语义（A 类）：整个业务域还没有任何实体（如 Courses=0 / Group projects=0）的
 * onboarding / zero-data 状态——占据 workspace 主内容区、有 title/description、可有 CTA。
 * 不适用（不要迁移到本组件）：
 * - Contextual Empty：domain 有数据但当前筛选/搜索/视图无结果（留在当前 Surface 内联表达）
 * - Analytical Empty：Analytics 数据覆盖不足（保持分析语义文案，由其 local EmptyState 承担）
 * - First Run onboarding（Overview Getting Started 有专属信息架构）
 *
 * 职责仅限 surface / alignment / spacing / typography / actions layout；
 * 不管理业务 state、不自动导航、不生成按钮。
 */
export interface WorkspaceEmptyStateProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  /** actions 由调用方组装（Primary / Secondary Button 等），本组件只负责排布 */
  actions?: React.ReactNode;
  className?: string;
}

export function WorkspaceEmptyState({
  title,
  description,
  icon,
  actions,
  className,
}: WorkspaceEmptyStateProps) {
  return (
    <div
      data-testid="workspace-empty-state"
      className={cn(
        // Level 1 workspace surface（与 dashboard-card 同基线）
        "bg-surface border border-line rounded-xl shadow-subtle",
        // 居中 + 克制的可读宽度（桌面工具，非营销页）
        "flex flex-col items-center justify-center gap-2.5 text-center",
        "p-6 md:p-10 mx-auto w-full max-w-xl",
        className
      )}
    >
      {icon ? (
        <div aria-hidden="true" className="text-sandrift mb-0.5">
          {icon}
        </div>
      ) : null}
      <p className="text-sm font-bold text-charcoal">{title}</p>
      {description ? (
        <p className="text-[11px] text-sandrift leading-relaxed">{description}</p>
      ) : null}
      {actions ? <div className="flex flex-wrap items-center justify-center gap-2 mt-1.5">{actions}</div> : null}
    </div>
  );
}
