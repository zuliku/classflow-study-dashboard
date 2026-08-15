"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { X, Expand } from "lucide-react";
import { useKiroSession } from "@/components/kiro/KiroSessionProvider";
import { KiroMark } from "@/components/kiro/KiroHeader";
import { KiroSessionActions } from "@/components/kiro/KiroSessionActions";
import { usePresence } from "@/lib/usePresence";
import { useKiroPreferencesStore } from "@/store/useKiroPreferencesStore";
import { SidecarSize, clampSidecarSize } from "@/lib/ai/ui/sidecarSize";
import { KiroSidecarResizeHandle } from "@/components/kiro/sidecar/KiroSidecarResizeHandle";
import { cn } from "@/lib/utils";

/**
 * Kiro Sidecar Shell（UX V2 + V2.1 correctness）：
 * - 非模态浮动面板（md+ 圆角 + shadow），无 backdrop，面板外可继续操作
 * - 进入/退出动画：usePresence（open 挂载 → visible；close 先播动画再卸载）
 * - Esc 可关闭；不点击外部关闭
 * - 尺寸：左边缘调宽 + 底边调高 + 左下角 handle；min/max + viewport clamp；持久化
 *
 * V2.1 修复：
 * 1. Single mount：同一 Shell DOM 用 responsive CSS（mobile full-screen ↔ desktop floating），
 *    `{children}` 只渲染一次（禁止双分支复制 KiroChatSurface）。
 * 2. Resize 以 drag origin snapshot 为基数（pointerdown 相对 delta 语义不变），
 *    latestDraftRef 保证最后一帧 pointermove 的 size 被持久化（防 React state batching stale）。
 */
export function KiroSidecarShell({ open, children }: { open: boolean; children: React.ReactNode }) {
  const session = useKiroSession();
  const { closeSidecar, expandSidecar } = session;
  const sidecarSize = useKiroPreferencesStore((s) => s.sidecarSize);
  const setSidecarSize = useKiroPreferencesStore((s) => s.setSidecarSize);

  // viewport 跟踪（clamp 上限；窗口 resize 时自动修正）
  const [viewport, setViewport] = useState(() => ({
    width: typeof window !== "undefined" ? window.innerWidth : 1280,
    height: typeof window !== "undefined" ? window.innerHeight : 800,
  }));
  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // 拖拽中的草稿尺寸：实时更新显示，pointerup 时一次性持久化（避免拖拽中高频写 localStorage）
  const [draft, setDraft] = useState<SidecarSize | null>(null);
  const clamped = useMemo(() => clampSidecarSize(sidecarSize, viewport), [sidecarSize, viewport]);
  const size = draft ?? clamped;

  // V2.1：drag origin snapshot + authoritative latest draft
  const resizeOriginRef = useRef<SidecarSize | null>(null);
  const latestDraftRef = useRef<SidecarSize | null>(null);

  // 持久化尺寸超出当前 viewport → 自动修正（不溢出）
  useEffect(() => {
    if (draft) return;
    if (clamped.width !== sidecarSize.width || clamped.height !== sidecarSize.height) {
      setSidecarSize(clamped);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clamped.width, clamped.height, draft]);

  const { mounted, visible } = usePresence(open, 160);

  // Esc 关闭（仅 open 时监听）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSidecar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeSidecar]);

  /** pointerdown：snapshot 当次 drag 开始时的可见尺寸（不是不断变化的 draft） */
  const beginResize = () => {
    resizeOriginRef.current = size;
  };

  /**
   * pointermove（delta 相对 drag 起点）：
   * nextSize = dragOriginSize + delta（禁止以 draft 为基数累计漂移）。
   */
  const applyDelta = (delta: { deltaWidth: number; deltaHeight: number }) => {
    const origin = resizeOriginRef.current ?? size;
    const next = clampSidecarSize(
      {
        width: origin.width + delta.deltaWidth,
        height: origin.height + delta.deltaHeight,
      },
      viewport
    );
    latestDraftRef.current = next;
    setDraft(next);
  };

  /** pointerup / pointercancel：以 latestDraftRef 为准（最后一帧 move 可能尚未 render） */
  const commitResize = () => {
    const finalSize = latestDraftRef.current;
    if (finalSize) {
      setSidecarSize(finalSize);
    }
    resizeOriginRef.current = null;
    latestDraftRef.current = null;
    setDraft(null);
  };

  if (!mounted) return null;

  return (
    <div
      data-testid="kiro-sidecar"
      data-state={open ? "open" : "closed"}
      role="dialog"
      aria-label="Kiro 侧边聊天"
      aria-hidden={!open}
      className={cn(
        // Single Shell：几何由 responsive CSS 切换（children 只 mount 一份）
        "fixed z-40 flex flex-col bg-surface overflow-hidden",
        // Mobile：<md full-screen（不用 persisted 尺寸）
        "inset-0 w-full h-full rounded-none pb-[env(safe-area-inset-bottom)]",
        // Desktop：md+ floating（persisted 尺寸经 CSS variables 生效）
        "md:inset-auto md:top-6 md:right-6 md:w-[var(--kiro-sidecar-width)] md:h-[var(--kiro-sidecar-height)] md:rounded-[28px] md:border md:border-line md:shadow-card",
        // Presence 动画
        "transition-[opacity,transform] ease-[var(--ease-standard)]",
        visible
          ? "duration-[var(--motion-panel)] translate-x-0 scale-100 opacity-100"
          : "duration-[160ms] translate-x-3 scale-[0.985] opacity-0 pointer-events-none"
      )}
      style={
        {
          "--kiro-sidecar-width": `${size.width}px`,
          "--kiro-sidecar-height": `${size.height}px`,
        } as React.CSSProperties
      }
    >
      <KiroSidecarHeader onExpand={expandSidecar} onClose={closeSidecar} />
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{children}</div>

      {/* Resize handles：仅 md+ 可见（responsive hidden，不复制容器） */}
      <KiroSidecarResizeHandle
        position="left"
        onResizeStart={beginResize}
        onResize={applyDelta}
        onResizeEnd={commitResize}
        className="hidden md:block"
      />
      <KiroSidecarResizeHandle
        position="bottom"
        onResizeStart={beginResize}
        onResize={applyDelta}
        onResizeEnd={commitResize}
        className="hidden md:block"
      />
      <KiroSidecarResizeHandle
        position="corner"
        onResizeStart={beginResize}
        onResize={applyDelta}
        onResizeEnd={commitResize}
        className="hidden md:block"
      />
    </div>
  );
}

function KiroSidecarHeader({ onExpand, onClose }: { onExpand: () => void; onClose: () => void }) {
  return (
    <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2.5 border-b border-line bg-surface">
      <div className="flex items-center gap-2 min-w-0">
        <KiroMark size="sm" />
        <h2 className="text-sm font-bold text-charcoal" data-testid="kiro-sidecar-title">
          Kiro
        </h2>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        <KiroSessionActions variant="sidecar" onExpand={onExpand} />
        <button
          onClick={onExpand}
          aria-label="展开到 Kiro 工作区"
          title="展开"
          className="w-8 h-8 flex items-center justify-center rounded-xl text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
        >
          <Expand className="w-4 h-4" />
        </button>
        <button
          onClick={onClose}
          aria-label="关闭 Kiro"
          title="关闭"
          className="w-8 h-8 flex items-center justify-center rounded-xl text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
