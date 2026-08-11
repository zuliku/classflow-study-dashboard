"use client";

import React from "react";
import { SettingsButton, SettingsButtonVariant } from "@/components/settings/SettingsControls";

/**
 * SettingsDangerRow（Settings V3 Task 1）：
 * 危险/动作类设置行的统一形态（卡片式 row + 右侧动作按钮）。
 * 仅承担布局与危险语义样式；确认交互（confirm dialog / 两阶段确认）由调用方注入。
 */
export function SettingsDangerRow({
  icon,
  title,
  description,
  actionLabel,
  variant = "danger",
  onAction,
  actionTestid,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  variant?: SettingsButtonVariant;
  onAction: () => void;
  actionTestid?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 p-3 bg-[#F7F5F5] border border-line rounded-xl">
      <div className="min-w-0">
        <p className={`font-bold ${variant === "danger" ? "text-danger" : "text-charcoal"}`}>
          {title}
        </p>
        <p className="text-[10px] text-satin-grey mt-0.5 break-words">{description}</p>
      </div>
      <SettingsButton variant={variant} onClick={onAction} testid={actionTestid}>
        {icon}
        {actionLabel}
      </SettingsButton>
    </div>
  );
}
