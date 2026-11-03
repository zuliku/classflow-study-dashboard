"use client";

import React from "react";
import { PanelRightClose } from "lucide-react";
import { KiroChatSurface } from "@/components/kiro/KiroChatSurface";
import { KiroMark } from "@/components/kiro/KiroHeader";
import { MOTION_EXIT_MS } from "@/lib/motion";
import { usePresence } from "@/lib/usePresence";
import { cn } from "@/lib/utils";
import type { GroupProject } from "@/types";

const DOCK_WIDTH = "w-[clamp(320px,24vw,440px)]";

/**
 * 小组协作 · 项目内嵌 Kiro（宽屏 Dock）。
 * - 与浮动 Sidecar 共用同一 Kiro Runtime / 会话，但以项目名 + 项目上下文在页面内呈现；
 * - 仅在 2xl+ 由 GroupCollaborationView 渲染（窄屏仍走既有 Sidecar）；
 * - 面板自身不拥有 handoff / 会话切换逻辑，避免与 Sidecar 争夺会话所有权。
 *
 * Motion：宽度使用同一外层 wrapper 做 0 ↔ 目标宽度过渡（detail 同步 reflow），
 * 内层固定宽度以避免动画期间文字重排；opacity + 8px 位移由 presence 驱动。
 * 退出使用 --motion-exit-panel / --ease-exit，进入使用 --motion-panel / --ease-spring。
 */
export function GroupKiroPanel({
  open,
  project,
  onClose,
}: {
  open: boolean;
  project: GroupProject;
  onClose: () => void;
}) {
  const { mounted, visible } = usePresence(open, MOTION_EXIT_MS.panel);
  if (!mounted) return null;

  return (
    <div
      id="group-kiro-panel"
      data-testid="group-kiro-panel"
      data-state={visible ? "open" : "closed"}
      aria-hidden={!visible}
      className={cn(
        "group-kiro-dock sticky top-20 ml-auto hidden h-[calc(100vh-120px)] shrink-0 self-start overflow-hidden transition-[width] 2xl:block",
        visible
          ? cn(DOCK_WIDTH, "duration-[var(--motion-panel)] ease-[var(--ease-spring)]")
          : "w-0 duration-[var(--motion-exit-panel)] ease-[var(--ease-exit)]"
      )}
    >
      <aside
        aria-label={`项目 Kiro：${project.title}`}
        {...(!visible ? ({ inert: "" } as unknown as React.HTMLAttributes<HTMLElement>) : {})}
        className={cn(
          "absolute right-0 top-0 flex h-full w-[clamp(320px,24vw,440px)] flex-col overflow-hidden rounded-xl border border-line-soft bg-surface/60",
          "transition-[opacity,transform]",
          visible
            ? "translate-x-0 opacity-100 duration-[var(--motion-panel)] ease-[var(--ease-spring)]"
            : "pointer-events-none translate-x-4 opacity-0 duration-[var(--motion-exit-panel)] ease-[var(--ease-exit)]"
        )}
      >
        <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-line-soft px-3">
          <div className="flex min-w-0 items-center gap-2">
            <KiroMark size="sm" />
            <div key={project.id} className="ux-detail-swap-in min-w-0 leading-tight">
              <p className="text-[12px] font-semibold text-charcoal">项目 Kiro</p>
              <p className="truncate text-[10px] text-sandrift">{project.title}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="收起 Kiro"
            data-testid="group-kiro-collapse"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sandrift transition-colors hover:bg-alabaster hover:text-charcoal focus-visible:outline-2 focus-visible:outline-charcoal/30"
          >
            <PanelRightClose className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">
          <KiroChatSurface variant="sidecar" />
        </div>
      </aside>
    </div>
  );
}
