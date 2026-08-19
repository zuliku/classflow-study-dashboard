"use client";

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { X } from "lucide-react";
import { useKiroPreferencesStore } from "@/store/useKiroPreferencesStore";
import { useKiroSessionActions, useKiroSessionMeta } from "@/components/kiro/KiroSessionProvider";
import {
  clampSidecarMinimizedPosition,
  SIDECAR_MINIMIZED_SIZE,
  DEFAULT_SIDECAR_MINIMIZED_POSITION,
} from "@/lib/ai/ui/sidecarMinimizedPosition";
import { KiroMark } from "@/components/kiro/KiroHeader";
import { cn } from "@/lib/utils";

const DRAG_THRESHOLD = 5;

/**
 * Kiro Minimized Capsule（V1）：
 * - 固定 176×46，右下角默认 24px
 * - 可拖拽（pointer capture，draft 本地，pointerup 一次持久化）
 * - 点击主区恢复，× 关闭；拖拽后不误触恢复
 * - 仅 md+ 可见（父级隐藏）；busy 低频 boolean
 * - 不订阅 streaming token
 */
export function KiroSidecarMinimized({ visible }: { visible: boolean }) {
  const { kiroBusy } = useKiroSessionMeta();
  const { restoreSidecar, closeSidecar } = useKiroSessionActions();
  const persisted = useKiroPreferencesStore((s) => s.sidecarMinimizedPosition);
  const setPersisted = useKiroPreferencesStore((s) => s.setSidecarMinimizedPosition);

  const [viewport, setViewport] = useState(() => ({
    width: typeof window !== "undefined" ? window.innerWidth : 1280,
    height: typeof window !== "undefined" ? window.innerHeight : 800,
  }));
  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const clampedPersisted = useMemo(
    () => clampSidecarMinimizedPosition(persisted ?? DEFAULT_SIDECAR_MINIMIZED_POSITION, viewport),
    [persisted, viewport]
  );

  // draft 本地位置（拖拽中即时跟手，不写 store）
  const [draft, setDraft] = useState<null | { right: number; bottom: number }>(null);
  const [dragging, setDragging] = useState(false);
  const position = draft ?? clampedPersisted;

  // 当 viewport 导致 persisted 超出边界，修正一次（避免死循环：只在非 dragging 时）
  const isDraggingRef = useRef(false);
  useEffect(() => {
    isDraggingRef.current = dragging;
  }, [dragging]);
  useEffect(() => {
    if (dragging) return;
    if (draft) return;
    if (clampedPersisted.right !== persisted.right || clampedPersisted.bottom !== persisted.bottom) {
      // 有些测试环境 localStorage 同步，这里只在真正超出时写回
      setPersisted(clampedPersisted);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampedPersisted.right, clampedPersisted.bottom]);

  // drag 状态（确定性 suppressNextClick，不靠 timer）
  const originRef = useRef<{ right: number; bottom: number } | null>(null);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const didDragRef = useRef(false);
  const suppressNextClickRef = useRef(false);
  const latestDraftRef = useRef<{ right: number; bottom: number } | null>(null);
  const prevUserSelectRef = useRef("");

  // 卸载时恢复 userSelect（drag 中异常关闭/卸载）
  useEffect(() => {
    return () => {
      if (document.body.style.userSelect === "none") {
        document.body.style.userSelect = prevUserSelectRef.current;
      }
    };
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // 关闭按钮不启动 drag（由 button stopPropagation 保证，但此处再保护）
      if ((e.target as HTMLElement).closest('[data-capsule-close="true"]')) return;
      if (e.button !== 0) return;
      originRef.current = position;
      startPointRef.current = { x: e.clientX, y: e.clientY };
      didDragRef.current = false;
      latestDraftRef.current = position;
      setDragging(true);
      prevUserSelectRef.current = document.body.style.userSelect;
      document.body.style.userSelect = "none";
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [position]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!originRef.current || !startPointRef.current) return;
      const dx = e.clientX - startPointRef.current.x;
      const dy = e.clientY - startPointRef.current.y;
      if (!didDragRef.current && Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
        didDragRef.current = true;
      }
      const origin = originRef.current;
      const next = clampSidecarMinimizedPosition(
        {
          right: origin.right - dx,
          bottom: origin.bottom - dy,
        },
        viewport
      );
      latestDraftRef.current = next;
      setDraft(next);
    },
    [viewport]
  );

  const finish = useCallback(
    (reason: "up" | "cancel" = "up") => {
      if (!originRef.current) return;
      const shouldPersist = didDragRef.current;
      const finalPos = latestDraftRef.current;
      originRef.current = null;
      startPointRef.current = null;
      setDragging(false);
      if (document.body.style.userSelect === "none") {
        document.body.style.userSelect = prevUserSelectRef.current;
      }
      setDraft(null);
      if (shouldPersist && finalPos) {
        setPersisted(finalPos);
        // 拖拽后确定性抑制下一次 click（不靠 timer）
        if (reason === "up") suppressNextClickRef.current = true;
        didDragRef.current = false;
        latestDraftRef.current = null;
      } else {
        didDragRef.current = false;
        latestDraftRef.current = null;
        if (reason === "cancel") suppressNextClickRef.current = false;
      }
    },
    [setPersisted]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => finish("up"),
    [finish]
  );
  const handlePointerCancel = useCallback(() => finish("cancel"), [finish]);

  const handleClickRestore = useCallback(
    (e: React.MouseEvent) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (didDragRef.current) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      restoreSidecar();
    },
    [restoreSidecar]
  );

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      // 防止 close 同时触发 drag restore
      didDragRef.current = false;
      originRef.current = null;
      startPointRef.current = null;
      setDragging(false);
      setDraft(null);
      closeSidecar();
    },
    [closeSidecar]
  );

  // 仅 md+ 可见；minimized 时 opacity 1，open/closed 时 hidden + inert
  return (
    <div
      data-testid="kiro-sidecar-capsule"
      data-dragging={dragging || undefined}
      aria-hidden={!visible}
      {...(!visible ? ({ inert: "" } as unknown as React.HTMLAttributes<HTMLDivElement>) : {})}
      className={cn(
        "hidden md:flex fixed z-40 items-center gap-2 px-2.5",
        "bg-surface border border-line rounded-full shadow-card",
        "select-none touch-none",
        "transition-[opacity,transform] ease-[var(--ease-standard)]",
        dragging ? "transition-none" : "duration-[160ms]",
        visible ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-[0.96] translate-y-1 pointer-events-none"
      )}
      style={
        {
          width: `${SIDECAR_MINIMIZED_SIZE.width}px`,
          height: `${SIDECAR_MINIMIZED_SIZE.height}px`,
          right: `${position.right}px`,
          bottom: `${position.bottom}px`,
        } as React.CSSProperties
      }
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      aria-label="Kiro 已最小化"
    >
      <button
        type="button"
        onClick={handleClickRestore}
        aria-label="恢复 Kiro"
        title="点击恢复 Kiro"
        className="flex-1 min-w-0 flex items-center gap-2 h-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-charcoal/40 rounded-full"
      >
        <span className="shrink-0 w-7 h-7 rounded-full bg-alabaster border border-line flex items-center justify-center">
          {/* 复用 KiroMark 小尺寸，或简化为文字 K */}
          <span className="text-[11px] font-black text-charcoal">K</span>
        </span>
        <span className="min-w-0 flex flex-col leading-none">
          <span className="text-[12px] font-bold text-charcoal truncate">Kiro</span>
          {kiroBusy && (
            <span className="text-[10px] font-semibold text-sandrift truncate" data-testid="kiro-capsule-busy">
              正在处理
            </span>
          )}
        </span>
      </button>

      <button
        type="button"
        data-capsule-close="true"
        onClick={handleClose}
        aria-label="关闭 Kiro"
        title="关闭"
        className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-charcoal/40"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
