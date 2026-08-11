"use client";

import React from "react";
import { SettingsButton, SettingsButtonVariant } from "@/components/settings/SettingsControls";
import { cn } from "@/lib/utils";

/**
 * SettingsActionRow（Settings V3 Task 6）：
 * 动作型设置的统一 row（备份 / 恢复 / 危险操作共用布局语言）。
 * - row padding / divider / title / description 与 SettingsRow 一致
 * - 右侧动作列统一使用 SettingsButton（高度/字号/圆角/icon 一致）
 * - Danger 只通过 variant 改变文字与按钮颜色，不改布局
 */
export function SettingsActionRow({
  title,
  description,
  variant = "secondary",
  icon,
  actionLabel,
  onAction,
  actionTestid,
  actionMinWidth,
}: {
  title: string;
  description: string;
  variant?: SettingsButtonVariant;
  icon?: React.ReactNode;
  actionLabel: string;
  onAction: () => void;
  actionTestid?: string;
  /** 动作列最小宽度（Data & Storage 组用，右缘对齐；不全局强制） */
  actionMinWidth?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 min-h-[56px] py-3 border-b border-line-soft last:border-b-0">
      <div className="min-w-0">
        <p className={cn("text-xs font-bold", variant === "danger" ? "text-danger" : "text-charcoal")}>
          {title}
        </p>
        <p className="text-[10px] text-satin-grey mt-0.5 break-words">{description}</p>
      </div>
      <SettingsButton
        variant={variant}
        onClick={onAction}
        testid={actionTestid}
        className={actionMinWidth}
      >
        {icon}
        {actionLabel}
      </SettingsButton>
    </div>
  );
}
