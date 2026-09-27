"use client";

import React, { useEffect, useState } from "react";
import { computeFps, shouldShowFpsProbe, isMotionDev } from "@/lib/motionDev";

/**
 * Motion fps 探针（Motion V3 收尾，dev-only）：
 * - 仅 development 构建 + ?motion-fps=1 可见，默认关闭；
 * - rAF 计数，500ms 窗口换算一次（computeFps 纯函数可测）；
 * - fixed 左下角 badge，不拦截指针（pointer-events-none），unmount 清理。
 */
export function MotionFpsProbe() {
  const [enabled] = useState(
    () => typeof window !== "undefined" && shouldShowFpsProbe(window.location.search)
  );
  const [fps, setFps] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    let frames = 0;
    let windowStart = performance.now();
    const tick = (now: number) => {
      frames += 1;
      const elapsed = now - windowStart;
      if (elapsed >= 500) {
        setFps(computeFps(frames, elapsed));
        frames = 0;
        windowStart = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);

  if (!isMotionDev() || !enabled) return null;

  return (
    <div
      data-testid="motion-fps-probe"
      aria-hidden="true"
      className="tabular-numeric pointer-events-none fixed bottom-3 left-3 z-[90] rounded-lg bg-charcoal px-2 py-1 font-mono text-[11px] font-bold text-white opacity-90"
    >
      {fps === null ? "fps …" : `${fps} fps`}
    </div>
  );
}
