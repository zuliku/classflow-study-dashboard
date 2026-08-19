"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { X, Expand, Minus } from "lucide-react";
import { useKiroSession, type KiroSidecarMode } from "@/components/kiro/KiroSessionProvider";
import { KiroMark } from "@/components/kiro/KiroHeader";
import { KiroSessionActions } from "@/components/kiro/KiroSessionActions";
import { usePresence } from "@/lib/usePresence";
import { useKiroPreferencesStore } from "@/store/useKiroPreferencesStore";
import { SidecarSize } from "@/lib/ai/ui/sidecarSize";
import {
  SidecarPosition,
  clampSidecarGeometry,
  clampSidecarPosition,
  clampSidecarSizeAtPosition,
} from "@/lib/ai/ui/sidecarPosition";
import { KiroSidecarResizeHandle } from "@/components/kiro/sidecar/KiroSidecarResizeHandle";
import { KiroSidecarMoveHandle } from "@/components/kiro/sidecar/KiroSidecarMoveHandle";
import { cn } from "@/lib/utils";

/**
 * Kiro Sidecar Shell（UX V2 + V2.1 correctness + Move V1）：
 * - 非模态浮动面板（md+ 圆角 + shadow），无 backdrop，面板外可继续操作
 * - 进入/退出动画：usePresence（open 挂载 → visible；close 先播动画再卸载）
 * - Esc 可关闭；不点击外部关闭
 * - 尺寸：左边缘调宽 + 底边调高 + 左下角 handle；min/max + viewport clamp；持久化
 * - 位置（Move V1）：顶部中央 hover-reveal 把手拖拽；top/right 表示；四边 ≥24px；
 *   持久化；close/reopen 与 refresh 均保留；resize 与 position 共同遵守 geometry invariant
 *
 * V2.1 修复：
 * 1. Single mount：同一 Shell DOM 用 responsive CSS（mobile full-screen ↔ desktop floating），
 *    `{children}` 只渲染一次（禁止双分支复制 KiroChatSurface）。
 * 2. Resize 以 drag origin snapshot 为基数（pointerdown 相对 delta 语义不变），
 *    latestDraftRef 保证最后一帧 pointermove 的 size 被持久化（防 React state batching stale）。
 *
 * Move V1：
 * - 位置用 CSS variables（top/right）实时更新，不用 transform（避免与 presence motion 冲突）
 * - Move 与 Resize 共享 interactionRef 互斥；pointermove 只更新 draft，pointerup 一次性持久化
 */
export function KiroSidecarShell(props: { mode: KiroSidecarMode; children: React.ReactNode } | { open: boolean; children: React.ReactNode }) {
  const mode: KiroSidecarMode = "mode" in props ? props.mode : props.open ? "open" : "closed";
  const children = props.children;
  const session = useKiroSession();
  const { closeSidecar, expandSidecar, minimizeSidecar } = session as unknown as { closeSidecar: () => void; expandSidecar: () => void; minimizeSidecar: () => void };
  const sidecarSize = useKiroPreferencesStore((s) => s.sidecarSize);
  const setSidecarSize = useKiroPreferencesStore((s) => s.setSidecarSize);
  const sidecarPosition = useKiroPreferencesStore((s) => s.sidecarPosition);
  const setSidecarPosition = useKiroPreferencesStore((s) => s.setSidecarPosition);

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

  // 拖拽中的草稿（size + position）：实时更新显示，pointerup 时一次性持久化
  const [draft, setDraft] = useState<SidecarSize | null>(null);
  const [draftPosition, setDraftPosition] = useState<SidecarPosition | null>(null);

  // 确定性几何：size → position（viewport resize 后一次修正，避免双 effect ping-pong）
  const clampedGeometry = useMemo(
    () => clampSidecarGeometry(sidecarSize, sidecarPosition, viewport),
    [sidecarSize, sidecarPosition, viewport]
  );
  const size = draft ?? clampedGeometry.size;
  const position = draftPosition ?? clampedGeometry.position;

  // V2.1：drag origin snapshot + authoritative latest draft（size / position）
  const resizeOriginRef = useRef<SidecarSize | null>(null);
  const latestDraftRef = useRef<SidecarSize | null>(null);
  const moveOriginRef = useRef<SidecarPosition | null>(null);
  const latestDraftPositionRef = useRef<SidecarPosition | null>(null);
  // Move / Resize 互斥（同族 geometry interaction，防 pointer capture 竞态）
  const interactionRef = useRef<"idle" | "move" | "resize">("idle");

  // 持久化几何超出当前 viewport → 自动修正（不溢出）
  useEffect(() => {
    if (draft || draftPosition) return;
    const sizeChanged =
      clampedGeometry.size.width !== sidecarSize.width ||
      clampedGeometry.size.height !== sidecarSize.height;
    const positionChanged =
      clampedGeometry.position.top !== sidecarPosition.top ||
      clampedGeometry.position.right !== sidecarPosition.right;
    if (sizeChanged) setSidecarSize(clampedGeometry.size);
    if (positionChanged) setSidecarPosition(clampedGeometry.position);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    clampedGeometry.size.width,
    clampedGeometry.size.height,
    clampedGeometry.position.top,
    clampedGeometry.position.right,
    draft,
    draftPosition,
  ]);

  const isMinimized = mode === "minimized";
  const isOpen = mode === "open";
  // Motion V1：geometry 交互期间降权内部 motion（intro/settle/popover transforms 近瞬时）
  const [geometryInteracting, setGeometryInteracting] = useState(false);

  // 支持两类调用：1) 经 KiroSidecar host（host 已做 closed 的 usePresence，Shell 仅管显隐）
  // 2) 直接在测试/独立场景以 open/mode 调用（需自行处理 closed 的 mount/unmount）
  // 为兼容测试，保持 usePresence（closed→卸载），但 host 场景下 mounted 始终 true（因为 host 仅在非 closed 渲染 Shell）
  const { mounted } = usePresence(mode !== "closed", 160);
  // Esc 关闭（仅 open 时监听；minimized 时不抢主界面 Esc）
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSidecar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, closeSidecar]);

  // 早期返回必须在所有 hooks 之后（保持 hooks 数量一致）
  if (!mounted) return null;

  // ---- Resize（position-aware clamp） ----

  /** pointerdown：snapshot 当次 drag 开始时的可见尺寸（不是不断变化的 draft） */
  const beginResize = () => {
    if (interactionRef.current !== "idle") return;
    interactionRef.current = "resize";
    resizeOriginRef.current = size;
    setGeometryInteracting(true);
  };

  /**
   * pointermove（delta 相对 drag 起点）：
   * nextSize = dragOriginSize + delta；上限按当前 position 收紧
   * （left resize 保持 right edge → 宽度受 right+margin 限制；bottom 同理）。
   */
  const applyDelta = (delta: { deltaWidth: number; deltaHeight: number }) => {
    if (interactionRef.current !== "resize") return;
    const origin = resizeOriginRef.current ?? size;
    const next = clampSidecarSizeAtPosition(
      {
        width: origin.width + delta.deltaWidth,
        height: origin.height + delta.deltaHeight,
      },
      position,
      viewport
    );
    latestDraftRef.current = next;
    setDraft(next);
  };

  /** pointerup / pointercancel：以 latestDraftRef 为准（最后一帧 move 可能尚未 render） */
  const commitResize = () => {
    if (interactionRef.current === "resize") {
      const finalSize = latestDraftRef.current;
      if (finalSize) {
        setSidecarSize(finalSize);
      }
      interactionRef.current = "idle";
    }
    resizeOriginRef.current = null;
    latestDraftRef.current = null;
    setDraft(null);
    setGeometryInteracting(false);
  };

  // ---- Move（top/right；delta 相对 drag 起点） ----

  const beginMove = () => {
    if (interactionRef.current !== "idle") return;
    interactionRef.current = "move";
    moveOriginRef.current = position;
    setGeometryInteracting(true);
  };

  const applyMove = (delta: { deltaX: number; deltaY: number }) => {
    if (interactionRef.current !== "move") return;
    const origin = moveOriginRef.current ?? position;
    const next = clampSidecarPosition(
      {
        top: origin.top + delta.deltaY,
        right: origin.right - delta.deltaX,
      },
      size,
      viewport
    );
    latestDraftPositionRef.current = next;
    setDraftPosition(next);
  };

  const commitMove = () => {
    if (interactionRef.current === "move") {
      const finalPosition = latestDraftPositionRef.current;
      if (finalPosition) {
        setSidecarPosition(finalPosition);
      }
      interactionRef.current = "idle";
    }
    moveOriginRef.current = null;
    latestDraftPositionRef.current = null;
    setDraftPosition(null);
    setGeometryInteracting(false);
  };

  // Capsule V1：open ↔ minimized 不卸载 ChatSurface，closed 由 usePresence 控制 unmount（host 与 standalone 均兼容）
  return (
    <div
      data-testid="kiro-sidecar"
      data-state={mode}
      data-geometry-interacting={geometryInteracting || undefined}
      role="dialog"
      aria-label="Kiro 侧边聊天"
      aria-hidden={isMinimized}
      // inert 确保 hidden Composer 不进 Tab 顺序（React 19+ 支持）
      {...(isMinimized ? ({ inert: "" } as unknown as React.HTMLAttributes<HTMLDivElement>) : {})}
      className={cn(
        // Single Shell：几何由 responsive CSS 切换（children 只 mount 一份）
        "fixed z-40 flex flex-col bg-surface overflow-hidden",
        // Mobile：<md full-screen（不用 persisted 尺寸/位置）
        "inset-0 w-full h-full rounded-none pb-[env(safe-area-inset-bottom)]",
        // Desktop：md+ floating（persisted 尺寸/位置经 CSS variables 生效；不用 transform 定位）
        "md:inset-auto md:top-[var(--kiro-sidecar-top)] md:right-[var(--kiro-sidecar-right)]",
        "md:w-[var(--kiro-sidecar-width)] md:h-[var(--kiro-sidecar-height)] md:rounded-[28px] md:border md:border-line md:shadow-card",
        // Minimize/Restore choreography（180–220ms，opacity+scale+轻 translate，禁止 width/height 动画）
        // open → minimized：opacity 1→0, scale 1→0.985, translate 微向胶囊方向；胶囊延迟 40–60ms 由自身控制
        // minimized 不可交互（aria-hidden + inert + pointer-events-none，已满足 a11y）
        isMinimized
          ? "opacity-0 scale-[0.985] pointer-events-none -translate-y-1 md:translate-x-1"
          : "opacity-100 scale-100 translate-x-0 translate-y-0",
        // 仅在交互或 mode 切换时过渡；drag 期间降权由 data-geometry-interacting 控制
        isMinimized
          ? "transition-[opacity,transform] duration-[180ms] ease-[var(--ease-standard)]"
          : "transition-[opacity,transform] duration-[var(--motion-panel)] ease-[var(--ease-standard)]"
      )}
      style={
        {
          "--kiro-sidecar-top": `${position.top}px`,
          "--kiro-sidecar-right": `${position.right}px`,
          "--kiro-sidecar-width": `${size.width}px`,
          "--kiro-sidecar-height": `${size.height}px`,
        } as React.CSSProperties
      }
    >
      {/* Move handle：md+ 顶部中央 hover-reveal（不进入 Tab order） */}
      <KiroSidecarMoveHandle
        onMoveStart={beginMove}
        onMove={applyMove}
        onMoveEnd={commitMove}
        className="hidden md:block"
      />
      <KiroSidecarHeader onMinimize={minimizeSidecar} onExpand={expandSidecar} onClose={closeSidecar} />
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

function KiroSidecarHeader({ onMinimize, onExpand, onClose }: { onMinimize: () => void; onExpand: () => void; onClose: () => void }) {
  return (
    <div
      data-testid="kiro-sidecar-header"
      className="shrink-0 flex h-16 items-center justify-between gap-2 px-3 border-b border-line bg-surface"
    >
      <div className="flex items-center gap-2 min-w-0">
        <KiroMark size="sm" />
        <h2 className="text-sm font-bold text-charcoal" data-testid="kiro-sidecar-title">
          Kiro
        </h2>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        <KiroSessionActions variant="sidecar" onExpand={onExpand} />
        <button
          onClick={onMinimize}
          aria-label="最小化 Kiro"
          title="最小化"
          className="hidden md:flex w-8 h-8 items-center justify-center rounded-xl text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
          data-testid="kiro-sidecar-minimize"
        >
          <Minus className="w-4 h-4" />
        </button>
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
