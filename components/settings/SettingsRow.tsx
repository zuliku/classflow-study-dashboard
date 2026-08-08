"use client";

import React from "react";
import { RotateCcw } from "lucide-react";

interface SettingsRowProps {
  /** 稳定 id（搜索跳转 / 已修改定位用），对应 Settings Registry 的 id */
  settingId?: string;
  title: string;
  description: string;
  /** 该偏好是否非默认（显示 ↶ 恢复默认） */
  modified?: boolean;
  onReset?: () => void;
  resetAriaLabel?: string;
  /** 高亮（搜索跳转短暂闪烁） */
  highlighted?: boolean;
  children: React.ReactNode;
}

/** 统一 Preference Row：标题 + 描述 + 右侧控件；非默认时提供单项恢复默认 */
export function SettingsRow({
  settingId,
  title,
  description,
  modified = false,
  onReset,
  resetAriaLabel,
  highlighted = false,
  children,
}: SettingsRowProps) {
  return (
    <div
      data-setting-id={settingId}
      className={[
        "flex items-center justify-between gap-4 py-3 border-b border-line-soft last:border-b-0 transition-colors duration-[var(--motion-fast)]",
        highlighted ? "bg-pastel-mint/60" : "",
      ].join(" ")}
    >
      <div className="min-w-0">
        <h4 className="text-xs font-bold text-charcoal">{title}</h4>
        <p className="text-[10px] text-sandrift mt-0.5">{description}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {modified && onReset && (
          <button
            onClick={onReset}
            aria-label={resetAriaLabel ?? `将${title}恢复默认`}
            title="恢复默认"
            className="p-1 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors opacity-70 hover:opacity-100"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
        {children}
      </div>
    </div>
  );
}
