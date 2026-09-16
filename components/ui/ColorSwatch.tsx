"use client";

import React from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ColorSwatchSize = "sm" | "md";

/**
 * 统一色块（课程调色板 + 新建课程颜色共用唯一语言）。
 * - 几何统一：圆形 + border-line + shadow-subtle；sm=24px（调色板网格/预设），md=32px（主选择区）。
 * - 选中：ring-2 ring-charcoal + 中心 ✓（深浅自适应）。
 * - 可移除：hover/focus 时右上 X 徽标；触屏常显弱化版，避免“点击即删”无 affordance。
 */
const SIZE_CLASSES: Record<ColorSwatchSize, string> = {
  sm: "w-6 h-6",
  md: "w-8 h-8",
};

function checkTone(bg: string): string {
  // 与 lib/color.isLightHex 同阈值，避免引入运行时依赖循环感知成本
  const m = /^#([0-9a-fA-F]{6})$/.exec(bg.trim());
  if (!m) return "text-charcoal";
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 128 ? "text-charcoal" : "text-white";
}

export function ColorSwatch({
  color,
  borderColor,
  size = "md",
  selected = false,
  removable = false,
  removeDisabled = false,
  removeLabel,
  title,
  ariaLabel,
  onSelect,
  onRemove,
  disabled = false,
  className,
}: {
  color: string;
  borderColor?: string;
  size?: ColorSwatchSize;
  selected?: boolean;
  removable?: boolean;
  removeDisabled?: boolean;
  removeLabel?: string;
  title?: string;
  ariaLabel?: string;
  onSelect?: () => void;
  onRemove?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("group/swatch relative inline-flex shrink-0", className)}>
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled || !onSelect}
        title={title ?? color}
        aria-label={ariaLabel ?? color}
        aria-pressed={onSelect ? selected : undefined}
        style={{
          backgroundColor: color,
          borderColor: borderColor ?? "var(--line)",
        }}
        className={cn(
          "inline-flex items-center justify-center rounded-full border shadow-subtle",
          "transition-transform duration-[var(--motion-snap)] ease-[var(--ease-standard)]",
          "focus-visible:outline-2 focus-visible:outline-charcoal/30 focus-visible:outline-offset-2",
          SIZE_CLASSES[size],
          selected && "ring-2 ring-charcoal ring-offset-1 ring-offset-surface",
          onSelect && !disabled && "ux-press hover:scale-[1.06] cursor-pointer",
          (!onSelect || disabled) && "cursor-default",
          disabled && "opacity-40"
        )}
      >
        {selected && onSelect ? (
          <Check
            aria-hidden="true"
            className={cn(size === "sm" ? "w-3 h-3" : "w-4 h-4", checkTone(color))}
            strokeWidth={3}
          />
        ) : null}
      </button>
      {removable && onRemove ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (!removeDisabled) onRemove();
          }}
          disabled={removeDisabled}
          title={removeDisabled ? "至少保留 1 种颜色" : (removeLabel ?? `移除颜色 ${color}`)}
          aria-label={removeLabel ?? `移除颜色 ${color}`}
          className={cn(
            "absolute -top-1 -right-1 w-4 h-4 rounded-full inline-flex items-center justify-center",
            "bg-charcoal text-white shadow-subtle",
            "transition-opacity duration-[var(--motion-fast)]",
            "focus-visible:outline-2 focus-visible:outline-charcoal/30",
            removeDisabled
              ? "opacity-0 pointer-events-none"
              : "opacity-70 sm:opacity-0 sm:group-hover/swatch:opacity-100 sm:group-focus-within/swatch:opacity-100 focus-visible:opacity-100 hover:!opacity-100"
          )}
        >
          <X aria-hidden="true" className="w-2.5 h-2.5" strokeWidth={3.5} />
        </button>
      ) : null}
    </span>
  );
}
