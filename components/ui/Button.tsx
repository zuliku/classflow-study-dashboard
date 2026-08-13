"use client";

import React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 全局 Button primitive（UI Productization Task 2A + IM3B Action Feedback）。
 * feature-neutral；不读 Store；透传全部原生 button props（aria / data 属性、type、disabled、title、onClick）。
 *
 * Press cycle：ux-press（active scale 0.98）+ transition 覆盖 background/border/color/transform（--motion-snap）。
 * Loading（可选，feature-neutral）：loading=true → disabled + aria-busy；原内容 opacity-0 保留占位（无 layout shift），
 * absolute overlay 显示 spinner（+可选 loadingLabel）。Button 只知 idle/loading；success/error 归业务层（Toast/inline）。
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "accent";
export type ButtonSize = "sm" | "md";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-charcoal text-white hover:bg-black",
  secondary: "bg-white border border-line text-charcoal hover:bg-alabaster",
  ghost: "text-satin-grey hover:bg-alabaster hover:text-charcoal",
  danger: "bg-danger-bg text-danger border border-danger-border hover:bg-danger-border",
  accent: "bg-pastel-mint text-charcoal hover:bg-pastel-mint",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[11px]",
  md: "h-9 px-3.5 text-xs",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 异步 pending：disabled + aria-busy + spinner overlay；原内容保留占位防 layout shift */
  loading?: boolean;
  /** loading 时 spinner 旁的文案（需短，避免明显宽于原内容） */
  loadingLabel?: React.ReactNode;
}

export function Button({
  variant = "secondary",
  size = "sm",
  type = "button",
  loading = false,
  loadingLabel,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "ux-press relative inline-flex items-center justify-center gap-1.5 rounded-lg font-bold shrink-0",
        "transition-[background-color,border-color,color,transform] duration-[var(--motion-snap)] ease-[var(--ease-standard)]",
        "focus-visible:outline-2 focus-visible:outline-charcoal/30 focus-visible:outline-offset-2",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className
      )}
      {...props}
    >
      <span
        className={cn(
          "inline-flex items-center justify-center gap-1.5",
          loading && "opacity-0"
        )}
      >
        {children}
      </span>
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
          {loadingLabel ? <span>{loadingLabel}</span> : null}
        </span>
      )}
    </button>
  );
}
