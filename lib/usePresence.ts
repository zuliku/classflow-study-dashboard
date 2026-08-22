import { useEffect, useState } from "react";
import { useEffectiveReducedMotion } from "@/hooks/useEffectiveReducedMotion";
import { MOTION_EXIT_MS } from "@/lib/motion";

/**
 * 轻量两阶段 presence：
 * open 时先挂载（隐藏态）→ 下一帧显示（触发进入过渡）；
 * 关闭时先隐藏 → duration 后再卸载（保证退出动画可播放）。
 *
 * duration 必须传入 Motion Contract 常量（MOTION_EXIT_MS.*，见 lib/motion.ts），
 * 且与组件 CSS 退出 transition 时长一致——禁止魔法数字。
 * 默认 panel 档（Drawer 级）；未传时视为遗漏，应补语义常量。
 */
export function usePresence(
  open: boolean,
  duration: number = MOTION_EXIT_MS.panel
): { mounted: boolean; visible: boolean } {
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
