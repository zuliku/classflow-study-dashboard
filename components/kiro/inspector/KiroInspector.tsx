"use client";

import React from "react";
import { usePresence } from "@/lib/usePresence";
import { MOTION_EXIT_MS, MOTION_MS } from "@/lib/motion";
import { KiroInspectorOutputs } from "@/components/kiro/inspector/KiroInspectorOutputs";
import { KiroInspectorSources } from "@/components/kiro/inspector/KiroInspectorSources";
import { KiroInspectorDivider } from "@/components/kiro/inspector/KiroInspectorSection";
import { cn } from "@/lib/utils";

/** Inspector 打开宽度（固定；不随内容变化 → streaming 期间不抖动） */
export const KIRO_INSPECTOR_WIDTH = 296;

/**
 * Kiro Inspector（V1.1）：Workspace 右侧面板（xl+；快捷键 / Header 按钮开关，非常驻）。
 *
 * - 开关：Cmd/Ctrl+I（Workspace 作用域）或 Header 按钮；默认关闭
 * - 动画：同一 shell 做 width morph（0 ↔ 296px，--kiro-motion-spatial）+ 内容 opacity；
 *   关闭后 presence 延迟卸载（退出动画可播放）；Reduced Motion 立即切换
 * - 结构：Outputs（当前 Conversation Artifact）→ Sources（Conversation 已登记来源）
 * - 单一一级 Surface + flat rows + section divider（无 Card 嵌套）
 * - 只消费低频 scalar（meta 状态 / version signal）；不订阅 token / stdout / messages
 * - 非 xl breakpoint 由 Header 的「最近文件」Popover 兜底；Mobile 不渲染
 */
export function KiroInspector({ open }: { open: boolean }) {
  const { mounted, visible } = usePresence(open, MOTION_EXIT_MS.panel);

  return (
    <div
      data-testid="kiro-inspector-shell"
      data-state={open ? "open" : "closed"}
      aria-hidden={!open}
      className={cn(
        "hidden xl:block shrink-0 min-h-0 overflow-hidden",
        "transition-[width] duration-[var(--kiro-motion-spatial,220ms)] ease-[var(--ease-standard)]",
        open ? "w-[296px]" : "w-0"
      )}
    >
      {mounted && (
        <div
          className={cn(
            "h-full pt-6 pb-6 pr-6",
            "transition-opacity ease-[var(--ease-standard)]",
            visible
              ? "opacity-100 duration-[var(--kiro-motion-structure,150ms)]"
              : "opacity-0 duration-[var(--motion-snap)]"
          )}
        >
          <aside
            data-testid="kiro-inspector"
            aria-label="Kiro Inspector"
            className="h-full w-[296px] min-h-0 flex flex-col overflow-hidden"
          >
            <div className="flex-1 min-h-0 overflow-y-auto rounded-2xl border border-line bg-surface shadow-subtle">
              <KiroInspectorOutputs />
              <KiroInspectorDivider />
              <KiroInspectorSources />
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

/** Inspector 开关的 Motion 常量（供测试 / 调用方复用；与 usePresence 同源） */
export const KIRO_INSPECTOR_MOTION = { exitMs: MOTION_EXIT_MS.panel, enterMs: MOTION_MS.data } as const;
