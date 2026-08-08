"use client";

import { useLayoutEffect, useRef, useState, useCallback } from "react";

export interface SlidingIndicatorStyle {
  /** translate3d 相对容器定位 */
  transform: string;
  width: number;
  height: number;
  opacity: number;
  /** 只过渡 transform / width / height / opacity，禁止 transition-all */
  transition: string;
}

/**
 * 共享 Selection Indicator：
 * 在容器内查找 `[data-indicator-key="${activeKey}"]`，
 * 用 getBoundingClientRect 计算相对位置，把单个 Indicator 从 A 平滑移到 B。
 *
 * 规则：
 * - 首次渲染 / resetKey 变化（如月份切换）：禁用过渡，直接锚定目标，
 *   避免「黑色滑块从 (0,0) 飞进来」或跨月长距离滑动。
 * - 目标不存在（如月份里没有该日期）：opacity 归零隐藏，并暂停过渡，
 *   下次出现时直接落位。
 * - ResizeObserver 监听容器尺寸变化（窗口缩放、布局变动）重新测量。
 * - 只在状态/尺寸变化时 measure，无 rAF loop、无 setInterval。
 * - Reduced Motion 由 globals.css 的 prefers-reduced-motion 统一收敛。
 */
export function useSlidingIndicator<T extends HTMLElement = HTMLDivElement>(
  activeKey: string,
  options?: { resetKey?: string | number; durationMs?: number }
) {
  const containerRef = useRef<T | null>(null);
  const [indicatorStyle, setIndicatorStyle] = useState<SlidingIndicatorStyle>({
    transform: "translate3d(0px, 0px, 0)",
    width: 0,
    height: 0,
    opacity: 0,
    transition: "none",
  });
  const skipTransitionRef = useRef(true);
  const durationMs = options?.durationMs ?? 180;
  const resetKey = options?.resetKey;

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>(
      `[data-indicator-key="${CSS.escape(activeKey)}"]`
    );
    if (!target) {
      // 目标不在当前空间（如月份切换后原日期不存在）：隐藏并暂停过渡
      skipTransitionRef.current = true;
      setIndicatorStyle((prev) =>
        prev.opacity === 0 ? prev : { ...prev, opacity: 0, transition: "none" }
      );
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    setIndicatorStyle({
      transform: `translate3d(${targetRect.left - containerRect.left}px, ${
        targetRect.top - containerRect.top
      }px, 0)`,
      width: targetRect.width,
      height: targetRect.height,
      opacity: 1,
      transition: skipTransitionRef.current
        ? "none"
        : `transform ${durationMs}ms var(--ease-emphasized), width ${durationMs}ms var(--ease-emphasized), height ${durationMs}ms var(--ease-emphasized), opacity 120ms var(--ease-standard)`,
    });
  }, [activeKey, durationMs]);

  // 挂载 + resetKey 变化：禁用过渡直接锚定；下一帧恢复过渡
  useLayoutEffect(() => {
    skipTransitionRef.current = true;
    measure();
    const raf = requestAnimationFrame(() => {
      skipTransitionRef.current = false;
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // activeKey 变化：同一空间内的选择移动，允许过渡
  useLayoutEffect(() => {
    measure();
  }, [activeKey, measure]);

  // 容器尺寸变化：重新测量（保留过渡，平滑跟随）
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(container);
    return () => ro.disconnect();
  }, [measure]);

  return {
    containerRef,
    indicatorStyle,
    ready: indicatorStyle.opacity === 1 && indicatorStyle.width > 0,
  };
}
