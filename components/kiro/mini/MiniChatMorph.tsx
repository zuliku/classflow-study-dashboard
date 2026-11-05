"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { KiroMark } from "@/components/kiro/KiroHeader";
import type { MiniChatWindowMode } from "@/lib/ai/miniChat/protocol";

/**
 * 展开/收起过渡层：原生窗口在展开开始时/收起结束时只做一次瞬间改尺寸，
 * 新增/缩掉的区域完全透明；可见卡片的形变全部在这里用 CSS 完成。
 *
 * 这样收起/展开过程中浏览器不会逐帧重设原生窗口（Windows 上这是卡顿的
 * 根因），只做一次单盒子的 width/height 动画 + Logo 的 transform 飞行。
 *
 * 共享元素：Logo 在「胶囊中心 22,22 / 28px」与「展开 Header 10,12 / 20px」
 * 之间移动；卡片与目标形态的圆角/表面一致，切换不可见。
 */
export const MiniChatMorph = React.memo(function MiniChatMorph({
  target,
  durationMs,
  onSettled,
}: {
  target: MiniChatWindowMode;
  durationMs: number;
  onSettled: () => void;
}) {
  const toHeader = target === "expanded";
  return (
    <div
      className="relative h-screen w-screen select-none overflow-hidden bg-transparent"
      data-testid="kiro-mini-morph"
      data-target={target}
      aria-hidden="true"
      style={{ "--mini-morph-ms": `${durationMs}ms` } as React.CSSProperties}
    >
      <div
        className={cn(
          "mini-morph-card absolute left-0 top-0 overflow-hidden rounded-[20px] bg-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] ring-1 ring-inset ring-line-soft",
          toHeader ? "mini-morph-card-expand" : "mini-morph-card-collapse"
        )}
        style={{ contain: "layout paint" }}
        onAnimationEnd={(event) => {
          // 卡片自身的 width/height 动画结束即切换目标形态；Logo 动画会冒泡，
          // 但 event.target 是 Logo，不触发。
          if (
            event.currentTarget === event.target &&
            event.animationName.startsWith("mini-morph-card-")
          ) {
            onSettled();
          }
        }}
      >
        <div
          className={cn(
            "mini-morph-logo absolute left-0 top-0 h-7 w-7",
            toHeader ? "mini-morph-logo-to-header" : "mini-morph-logo-to-center"
          )}
        >
          <KiroMark size="md" className="h-7 w-7" />
        </div>
      </div>
    </div>
  );
});
