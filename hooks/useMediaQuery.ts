"use client";

import { useEffect, useState } from "react";

/**
 * 订阅 CSS media query（SSR / jsdom 无 matchMedia 时安全降级为 false）。
 * 仅用于 presentation 分支（如宽屏 Dock 与浮动 Sidecar 的入口选择），不写入持久状态。
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);

  return matches;
}
