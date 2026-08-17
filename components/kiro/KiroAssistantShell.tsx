"use client";

import React from "react";
import { KiroMark } from "@/components/kiro/KiroHeader";

/**
 * Kiro Assistant Shell（Streaming UX V4.6）：
 * Pending（正在准备）与 KiroMessage 共用的最小外层——KiroMark + body column。
 * 目标：Pending → 第一条 commentary/Tool → Final Answer 之间 Logo / 左侧 column 不 remount、
 * geometry 完全一致（无动画、无 fade——真实事件到达即展示）。
 */
export function KiroAssistantShell({
  children,
  testid,
  messageId,
}: {
  children: React.ReactNode;
  testid?: string;
  /** 纯 DOM metadata（V4.7.2 benchmark：turn/message 精确绑定；无状态、无行为变化） */
  messageId?: string;
}) {
  return (
    <div
      className="flex gap-3 group"
      data-testid={testid ?? "kiro-assistant-shell"}
      data-message-id={messageId ?? undefined}
    >
      <KiroMark size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-2 pt-0.5">{children}</div>
    </div>
  );
}
