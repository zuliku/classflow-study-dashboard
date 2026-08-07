import { useEffect, useState } from "react";

/**
 * 轻量两阶段 presence：
 * open 时先挂载（隐藏态）→ 下一帧显示（触发进入过渡）；
 * 关闭时先隐藏 → duration 后再卸载（保证退出动画可播放）。
 */
export function usePresence(open: boolean, duration = 260): { mounted: boolean; visible: boolean } {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() =>
        requestAnimationFrame(() => setVisible(true))
      );
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    const timer = window.setTimeout(() => setMounted(false), duration);
    return () => window.clearTimeout(timer);
  }, [open, duration]);

  return { mounted, visible };
}
