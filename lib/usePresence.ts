import { useEffect, useState } from "react";
import { useEffectiveReducedMotion } from "@/hooks/useEffectiveReducedMotion";

/**
 * 轻量两阶段 presence：
 * open 时先挂载（隐藏态）→ 下一帧显示（触发进入过渡）；
 * 关闭时先隐藏 → duration 后再卸载（保证退出动画可播放）。
 */
export function usePresence(open: boolean, duration = 260): { mounted: boolean; visible: boolean } {
  const reducedMotion = useEffectiveReducedMotion();
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let firstFrame = 0;
    let secondFrame = 0;
    let exitTimer = 0;

    if (open) {
      setMounted(true);
      if (reducedMotion) {
        setVisible(true);
      } else {
        firstFrame = requestAnimationFrame(() => {
          secondFrame = requestAnimationFrame(() => setVisible(true));
        });
      }
    } else {
      setVisible(false);
      if (reducedMotion) {
        setMounted(false);
      } else {
        exitTimer = window.setTimeout(() => setMounted(false), duration);
      }
    }

    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      window.clearTimeout(exitTimer);
    };
  }, [open, duration, reducedMotion]);

  return { mounted, visible };
}
