"use client";

import React from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 行内错误统一面（表单/面板内联错误唯一口径）：
 * - role="alert"（读屏打断；空态/提示用 WorkspaceEmptyState，不用本组件）
 * - 图标 + 文案 + danger 底，与 Toast error 同语言
 * - 调用方透传 data-testid（既有 e2e 锚点保留），不再手写裸 <p> 错误
 */
export function InlineErrorState({
  children,
  testid,
  className,
}: {
  children: React.ReactNode;
  testid?: string;
  className?: string;
}) {
  return (
    <p
      role="alert"
      data-testid={testid}
      className={cn(
        "text-xs font-bold text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2 animate-enter",
        className
      )}
    >
      <span className="inline-flex items-start gap-1.5">
        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
        <span className="min-w-0">{children}</span>
      </span>
    </p>
  );
}
