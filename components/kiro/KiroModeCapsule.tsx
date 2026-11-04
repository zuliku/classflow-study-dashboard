"use client";

import React from "react";
import { cn } from "@/lib/utils";

export type KiroModeCapsuleMode = "chat" | "work";

const SEGMENTS: { mode: KiroModeCapsuleMode; label: string }[] = [
  { mode: "chat", label: "聊天" },
  { mode: "work", label: "工作" },
];

/**
 * Kiro 模式胶囊（P1 产品化，参考 Codex 顶部“聊天 / 工作”分段）：
 * - 两段直选：聊天 = 纯聊天（Computer 关闭）；工作 = Agent 模式（Computer 开启，
 *   恢复既有 AgentMode；细粒度授权在下方聊天框的访问菜单调整）
 * - 模型信息不在此展示（Composer 模型胶囊保留厂商图标，避免重复）
 * - Turn 运行中切到聊天禁用（改当前 Turn scope），切到工作常开（下一 Turn 生效）。
 */
export function KiroModeCapsule({
  active,
  turnInFlight,
  onSelect,
}: {
  active: KiroModeCapsuleMode;
  turnInFlight?: boolean;
  onSelect: (mode: KiroModeCapsuleMode) => void;
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [pill, setPill] = React.useState<{ left: number; width: number } | null>(null);
  // 滑动指示条：测量激活段位置，transform 位移（只动合成层，left 固定为 0 不触发布局）
  React.useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      const activeBtn = container.querySelector('[aria-pressed="true"]');
      if (!(activeBtn instanceof HTMLElement)) return;
      const c = container.getBoundingClientRect();
      const b = activeBtn.getBoundingClientRect();
      if (b.width === 0) return;
      const next = { left: b.left - c.left, width: b.width };
      setPill((prev) => (prev && prev.left === next.left && prev.width === next.width ? prev : next));
    };
    measure();
    // 窗口缩放/字体加载/Sidecar 拖宽后重算，避免指示条错位
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(container);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [active]);
  return (
    <div
      ref={containerRef}
      role="group"
      aria-label="模式"
      data-testid="kiro-mode-capsule"
      className="relative inline-flex items-center rounded-full border border-line bg-surface p-0.5 shadow-subtle"
    >
      {pill && (
        <span
          aria-hidden="true"
          // 小浮层位移用 control 档（不用 spatial spring：胶囊是轻量切换，非空间位移）
          className="kiro-mode-capsule-indicator absolute left-0 top-0.5 bottom-0.5 rounded-full bg-charcoal shadow-subtle transition-[transform,width] duration-[var(--kiro-motion-control,var(--motion-fast))] ease-[var(--ease-standard)]"
          style={{ width: pill.width, transform: `translateX(${pill.left}px)` }}
        />
      )}
      {SEGMENTS.map((s) => {
        const isActive = s.mode === active;
        const locked = !!turnInFlight && s.mode === "chat";
        return (
          <button
            key={s.mode}
            type="button"
            onClick={() => {
              if (!locked) onSelect(s.mode);
            }}
            disabled={locked}
            aria-pressed={isActive}
            className={cn(
              "relative z-10 h-7 px-4 rounded-full text-[11px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
              isActive ? "text-white" : "text-sandrift hover:text-charcoal"
            )}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
