"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Kiro Sidecar Move Handle（Move V1）：顶部中央 hover-reveal 拖拽把手。
 * - 仅 pointer（mouse/pen）；aria-hidden，不进 Tab order（键盘用户不受影响）
 * - delta 相对 pointerdown 起点（不逐帧累计）；body userSelect 拖拽期间禁用
 * - unmount cleanup：拖拽中关闭 Sidecar 也必须恢复文本选择
 * - dragging 时 pill 保持可见（即使 pointer 离开 hit area）
 */
export function KiroSidecarMoveHandle({
  onMoveStart,
  onMove,
  onMoveEnd,
  className,
}: {
  /** pointerdown：父级 snapshot drag origin position */
  onMoveStart?: () => void;
  /** 拖拽中实时增量（相对 pointerdown 起点） */
  onMove: (delta: { deltaX: number; deltaY: number }) => void;
  onMoveEnd?: () => void;
  /** 额外响应式 class（如 mobile 隐藏） */
  className?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const prevBodyUserSelectRef = useRef("");

  const restoreUserSelect = useCallback(() => {
    // 只恢复由当前 drag 设置的状态（若已被其它 interaction 改值则不覆盖）
    if (document.body.style.userSelect === "none") {
      document.body.style.userSelect = prevBodyUserSelectRef.current;
    }
  }, []);

  // unmount cleanup：拖拽中关闭/unmount 时恢复文本选择
  useEffect(() => {
    return () => {
      if (startRef.current) {
        restoreUserSelect();
      }
    };
  }, [restoreUserSelect]);

  const finish = useCallback(() => {
    if (!startRef.current) return;
    startRef.current = null;
    restoreUserSelect();
    setDragging(false);
    onMoveEnd?.();
  }, [onMoveEnd, restoreUserSelect]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      onMoveStart?.();
      startRef.current = { x: e.clientX, y: e.clientY };
      prevBodyUserSelectRef.current = document.body.style.userSelect;
      document.body.style.userSelect = "none";
      setDragging(true);
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [onMoveStart]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const start = startRef.current;
      if (!start) return;
      onMove({
        deltaX: e.clientX - start.x,
        deltaY: e.clientY - start.y,
      });
    },
    [onMove]
  );

  return (
    <div
      data-testid="kiro-sidecar-move-handle"
      aria-hidden="true"
      className={cn(
        // 顶部中央 activation hit area（约 56×16px；视觉透明，hover 显示 pill）
        "absolute left-1/2 top-0 z-30 h-4 w-14 -translate-x-1/2 touch-none select-none",
        dragging ? "cursor-grabbing" : "cursor-grab",
        className
      )}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      <div
        className={cn(
          "mx-auto mt-[5px] h-[4px] w-8 rounded-full transition-opacity duration-[120ms] ease-[var(--ease-standard)]",
          hovered || dragging ? "opacity-100" : "opacity-0",
          dragging ? "bg-sandrift/70" : "bg-sandrift/40"
        )}
      />
    </div>
  );
}
