"use client";

import { useEffect, useState } from "react";
import { isMotionEasingV5Active, MOTION_EASING_EVENT } from "@/lib/motionDev";

/**
 * Motion V5 灰度运行时读取（供 Framer Motion / WAAPI 等无法直接消费 CSS 变量的程序化动画）。
 * CSS 侧仍由 html[data-motion-easing="v5"] 驱动；本 hook 只在 Gallery 切换时同步，
 * 不参与每帧动画，也不改变 reduced-motion 逻辑。
 */
export function useMotionEasingV5(): boolean {
  const [enabled, setEnabled] = useState(isMotionEasingV5Active);

  useEffect(() => {
    const sync = () => setEnabled(isMotionEasingV5Active());
    window.addEventListener(MOTION_EASING_EVENT, sync);
    return () => window.removeEventListener(MOTION_EASING_EVENT, sync);
  }, []);

  return enabled;
}
