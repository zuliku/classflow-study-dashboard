"use client";

import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useEffectiveReducedMotion } from "@/hooks/useEffectiveReducedMotion";
import { cn } from "@/lib/utils";

/**
 * 全局 SegmentedControl primitive（UI Productization Task 2A + IM3A Selection Continuity）。
 * role=group + aria-pressed buttons；共享 Active Plate 在 option 之间移动（同一 selection surface）。
 * - Plate：absolute + transform translate + width（不动画 left/margin）；transition-[transform,width]
 *   duration --motion-base（Selection = 连续空间运动，base tier；Workflow UX Motion M3
 *   收口 orphan --motion-select）+ ease --ease-emphasized（前段快跟随、末端轻 settle）；
 *   首次 mount 直接定位不播放动画；value 程序化变化同样移动。
 * - Button：只负责 text/aria/disabled（active 不再自绘 bg-white/shadow-subtle）。
 * - 单行（Settings narrow 为 overflow-x-auto 而非 wrap），plate 随内容一起滚动。
 * - Reduced Motion：直接定位（duration-0）。
 */
export interface SegmentedOption<T extends string | number> {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string | number> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  ariaLabel?: string;
  className?: string;
  /** Workflow UX Motion M3：xs = compact option（px-2 py-0.5 text-[10px]），供 StudyOutlook 等小尺寸场景 */
  size?: "sm" | "xs";
}

const OPTION_SIZE_CLASSES: Record<NonNullable<SegmentedControlProps<string>["size"]>, string> = {
  sm: "px-2.5 py-1.5 text-[11px]",
  xs: "px-2 py-0.5 text-[10px]",
};

export function SegmentedControl<T extends string | number>({
  value,
  onChange,
  options,
  ariaLabel,
  className,
  size = "sm",
}: SegmentedControlProps<T>) {
  const reducedMotion = useEffectiveReducedMotion();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Map<T, HTMLButtonElement>>(new Map());
  const measuredRef = useRef(false);
  const [plate, setPlate] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const measure = useCallback(() => {
    const el = optionRefs.current.get(value);
    if (!el) return;
    setPlate({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    measuredRef.current = true;
  }, [value]);

  // 首次 / value 变化：paint 前同步定位（首次无 transition，因首次 mount 无旧状态）
  useLayoutEffect(() => {
    measure();
  }, [measure]);

  // 容器尺寸变化（Settings 横向滚动 / 窗口）→ 重测当前 active
  useLayoutEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(c);
    return () => ro.disconnect();
  }, [measure]);

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "relative flex items-center gap-1 bg-alabaster p-0.5 rounded-lg border border-line-strong",
        className
      )}
    >
      {plate && (
        <div
          aria-hidden="true"
          className={cn(
            // 明确 absolute 原点：left-0 top-0，坐标全部由 transform 表达（避免 static position 参与导致偏移）
            "absolute left-0 top-0 rounded-md bg-white shadow-subtle pointer-events-none",
            "transition-[transform,width] ease-[var(--ease-emphasized)]",
            measuredRef.current && !reducedMotion
              ? "duration-[var(--motion-base)]"
              : "duration-0"
          )}
          style={{ transform: `translate(${plate.x}px, ${plate.y}px)`, width: plate.w, height: plate.h }}
        />
      )}
      {options.map((option) => {
        const isActive = value === option.value;
        return (
          <button
            key={String(option.value)}
            ref={(el) => {
              if (el) optionRefs.current.set(option.value, el);
              else optionRefs.current.delete(option.value);
            }}
            type="button"
            aria-pressed={isActive}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative z-10 rounded-md font-bold whitespace-nowrap transition-colors duration-[var(--motion-fast)]",
              OPTION_SIZE_CLASSES[size],
              "active:opacity-[0.78] active:duration-[var(--motion-snap)]",
              "focus-visible:outline-2 focus-visible:outline-charcoal/30",
              "disabled:opacity-40 disabled:cursor-not-allowed",
              isActive ? "text-charcoal" : "text-satin-grey hover:text-charcoal"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
