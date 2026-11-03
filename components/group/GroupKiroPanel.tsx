"use client";

import React from "react";
import { PanelRightClose } from "lucide-react";
import { KiroChatSurface } from "@/components/kiro/KiroChatSurface";
import { KiroMark } from "@/components/kiro/KiroHeader";
import type { GroupProject } from "@/types";

/**
 * 小组协作 · 项目内嵌 Kiro（宽屏 Dock）。
 * - 与浮动 Sidecar 共用同一 Kiro Runtime / 会话，但以项目名 + 项目上下文在页面内呈现；
 * - 仅在 2xl+ 由 GroupCollaborationView 渲染（窄屏仍走既有 Sidecar）；
 * - 面板自身不拥有 handoff / 会话切换逻辑，避免与 Sidecar 争夺会话所有权。
 */
export function GroupKiroPanel({
  project,
  onClose,
}: {
  project: GroupProject;
  onClose: () => void;
}) {
  return (
    <aside
      id="group-kiro-panel"
      data-testid="group-kiro-panel"
      aria-label={`项目 Kiro：${project.title}`}
      className="group-kiro-dock ux-fade sticky top-20 ml-auto hidden h-[calc(100vh-120px)] w-[clamp(320px,24vw,440px)] shrink-0 self-start flex-col overflow-hidden rounded-xl border border-line-soft bg-surface/60 2xl:flex"
    >
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-line-soft px-3">
        <div className="flex min-w-0 items-center gap-2">
          <KiroMark size="sm" />
          <div className="min-w-0 leading-tight">
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
  );
}
