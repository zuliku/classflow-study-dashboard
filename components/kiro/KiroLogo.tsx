import React from "react";
import { cn } from "@/lib/utils";

/**
 * Kiro 正式品牌 Logo（统一入口）。
 * mark：图形 Logo（不含文字，用于 icon 场景）
 * full：图形 + "Kiro" 文字（用于完整展示）
 * 资源为透明背景 PNG，object-contain 保比例，不做 recolor / 白底。
 */
const MARK_SRC = "/kiro/kiro-mark.png";
const FULL_SRC = "/kiro/kiro-logo.png";

/** 图标形态（KIRO_ICON 指向此组件）：只渲染 Logo 图形，尺寸由 className 控制 */
export function KiroLogoIcon({ className }: { className?: string }) {
  return (
    <img
      src={MARK_SRC}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn("object-contain select-none shrink-0", className)}
    />
  );
}

export function KiroLogo({
  variant = "mark",
  size = "md",
  className,
  decorative,
}: {
  variant?: "mark" | "full";
  size?: "sm" | "md" | "lg";
  className?: string;
  /** decorative=true 时标记 aria-hidden 并去除 alt 语义 */
  decorative?: boolean;
}) {
  const src = variant === "mark" ? MARK_SRC : FULL_SRC;
  const sizeClass =
    variant === "mark"
      ? size === "sm"
        ? "w-4 h-4"
        : size === "lg"
          ? "w-8 h-8"
          : "w-6 h-6"
      : size === "sm"
        ? "h-4 w-auto"
        : size === "lg"
          ? "h-8 w-auto"
          : "h-6 w-auto";
  return (
    <img
      src={src}
      alt={decorative ? "" : "Kiro"}
      aria-hidden={decorative || undefined}
      draggable={false}
      className={cn("object-contain select-none shrink-0", sizeClass, className)}
    />
  );
}
