"use client";

import React, { useEffect, useMemo, useState } from "react";
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
 * Kiro Sidecar Shell（UX V2）：非模态、可调尺寸、圆角浮动聊天面板。
 * - md+：右侧浮动浮层（rounded-[28px] + shadow-card），无全屏遮罩，面板外可继续操作
 * - <md：保留全屏 Sheet（Mobile 场景；不渲染 resize handle）
 * - 进入/退出动画：usePresence（open 挂载 → visible；close 先播动画再卸载）
 * - Esc 可关闭；不点击外部关闭（避免误关）
 * - 尺寸：左边缘调宽 + 底边调高 + 左下角 handle；min/max + viewport clamp；持久化
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

  const applyDelta = (delta: { deltaWidth: number; deltaHeight: number }) => {
    setDraft(
      clampSidecarSize(
        { width: size.width + delta.deltaWidth, height: size.height + delta.deltaHeight },
        viewport
      )
    );
  };
  const commitResize = () => {
    if (draft) {
      setSidecarSize(draft);
      setDraft(null);
    }
  };

  if (!mounted) return null;

  const panelTransition = cn(
    "transition-[opacity,transform] ease-[var(--ease-standard)]",
    visible
      ? "duration-[var(--motion-panel)] translate-x-0 scale-100 opacity-100"
      : "duration-[160ms] translate-x-3 scale-[0.985] opacity-0 pointer-events-none"
  );

  return (
    <>
      {/* <768：全屏 Sheet（无 resize） */}
      <div
        data-testid="kiro-sidecar-mobile"
        data-state={open ? "open" : "closed"}
        aria-hidden={!open}
        className={cn(
          "md:hidden fixed inset-0 z-40 flex flex-col bg-surface pb-[env(safe-area-inset-bottom)]",
          panelTransition
        )}
      >
        <KiroSidecarHeader onExpand={expandSidecar} onClose={closeSidecar} />
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{children}</div>
      </div>

      {/* md+：非模态浮动面板（可调尺寸 / 圆角 / 无遮罩） */}
      <div
        data-testid="kiro-sidecar"
        data-state={open ? "open" : "closed"}
        role="dialog"
        aria-label="Kiro 侧边聊天"
        aria-hidden={!open}
        className={cn(
          "hidden md:flex fixed top-6 right-6 z-40 flex-col overflow-hidden rounded-[28px] border border-line bg-surface shadow-card",
          panelTransition
        )}
        style={{ width: size.width, height: size.height }}
      >
        <KiroSidecarHeader onExpand={expandSidecar} onClose={closeSidecar} />
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{children}</div>

        {/* Resize handles（仅 md+） */}
        <KiroSidecarResizeHandle position="left" onResize={applyDelta} onResizeEnd={commitResize} />
        <KiroSidecarResizeHandle position="bottom" onResize={applyDelta} onResizeEnd={commitResize} />
        <KiroSidecarResizeHandle position="corner" onResize={applyDelta} onResizeEnd={commitResize} />
      </div>
    </>
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
