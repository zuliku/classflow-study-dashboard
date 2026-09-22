"use client";

import React from "react";
import { KiroInspectorOutputs } from "@/components/kiro/inspector/KiroInspectorOutputs";
import { KiroInspectorSources } from "@/components/kiro/inspector/KiroInspectorSources";
import { KiroInspectorComputer } from "@/components/kiro/inspector/KiroInspectorComputer";
import { KiroInspectorDivider } from "@/components/kiro/inspector/KiroInspectorSection";

/**
 * Kiro Inspector（V1）：Workspace 右侧固定列（xl+ 常驻）。
 *
 * 结构：Outputs（当前 Conversation Artifact）→ Sources（Conversation 已登记来源）→ Computer（真实状态概览）。
 * - 固定宽度 296px（streaming 期间不抖动；不随内容有无改变宽度）
 * - 单一一级 Surface + flat rows + section divider（无 Card 嵌套）
 * - 只消费低频 scalar（meta 状态 / version signal）；不订阅 token / stdout / messages
 * - 非 xl breakpoint 由 Header 的「最近文件」Popover 兜底；Mobile 不渲染
 */
export function KiroInspector() {
  return (
    <aside
      data-testid="kiro-inspector"
      aria-label="Kiro Inspector"
      className="hidden xl:flex w-[296px] shrink-0 min-h-0 flex-col overflow-hidden"
    >
      <div className="flex-1 min-h-0 overflow-y-auto rounded-2xl border border-line bg-surface shadow-subtle">
        <KiroInspectorOutputs />
        <KiroInspectorDivider />
        <KiroInspectorSources />
        <KiroInspectorDivider />
        <KiroInspectorComputer />
      </div>
    </aside>
  );
}
