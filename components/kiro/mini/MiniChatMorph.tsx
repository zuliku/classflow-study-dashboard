"use client";

import React from "react";
import { KiroMark } from "@/components/kiro/KiroHeader";
import type { MiniChatWindowMode } from "@/lib/ai/miniChat/protocol";

/**
 * 展开/收起过渡层：窗口 bounds 动画期间只渲染这一层轻量表面。
 *
 * 为什么需要它：窗口每一帧 resize 都会触发布局；如果此时仍挂载完整聊天
 * 界面（消息列表 + Markdown），每帧都会重排一次，表现为明显卡顿。
 *
 * 共享元素：Logo 在「胶囊中心」与「展开态 Header 左上角」之间飞行，
 * 尺寸同步 28px ↔ 20px。窗口到位后目标形态挂载，Logo 位置/尺寸完全对齐，
 * 切换不可见。飞行轨迹用 `vw/vh` 跟随窗口实时中心，纯 transform 合成。
 */
export const MiniChatMorph = React.memo(function MiniChatMorph({
  target,
  durationMs,
}: {
  target: MiniChatWindowMode;
  durationMs: number;
}) {
  const toHeader = target === "expanded";
  return (
    <div
      className="mini-drag-region relative h-screen w-screen select-none overflow-hidden rounded-[20px] bg-surface"
      data-testid="kiro-mini-morph"
      data-target={target}
      aria-hidden="true"
      style={{ "--mini-morph-ms": `${durationMs}ms` } as React.CSSProperties}
    >
      <span className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-line-soft" />
      <div className="flex h-full w-full items-center justify-center">
        <div
          className={
            toHeader ? "mini-morph-travel-to-header" : "mini-morph-travel-to-center"
          }
        >
          <KiroMark
            size="md"
            className={toHeader ? "mini-morph-scale-to-header" : "mini-morph-scale-to-center"}
          />
        </div>
      </div>
    </div>
  );
});
