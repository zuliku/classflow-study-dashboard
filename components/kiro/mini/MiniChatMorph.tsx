"use client";

import React from "react";
import { KiroMark } from "@/components/kiro/KiroHeader";
import type { MiniChatWindowMode } from "@/lib/ai/miniChat/protocol";

/**
 * 展开/收起过渡层：窗口 bounds 动画期间只渲染这一层轻量表面。
 *
 * 为什么需要它：窗口每一帧 resize 都会触发布局；如果此时仍挂载完整聊天
 * 界面（消息列表 + Markdown），每帧都会重排一次，表现为明显卡顿。
 * 这里只保留「表面 + 居中 Logo」，与胶囊态视觉一致，动画结束后再挂载
 * 目标形态。
 */
export function MiniChatMorph({ target }: { target: MiniChatWindowMode }) {
  return (
    <div
      className="mini-drag-region relative h-screen w-screen select-none overflow-hidden rounded-[20px] bg-surface"
      data-testid="kiro-mini-morph"
      aria-hidden="true"
    >
      <span className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-line-soft" />
      <div className="flex h-full w-full items-center justify-center">
        <KiroMark
          size="md"
          className={target === "expanded" ? "mini-morph-logo-out" : "mini-morph-logo-in"}
        />
      </div>
    </div>
  );
}
