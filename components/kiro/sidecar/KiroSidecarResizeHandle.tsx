"use client";

import React, { useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export type SidecarHandlePosition = "left" | "bottom" | "corner";

const CURSOR: Record<SidecarHandlePosition, string> = {
  left: "cursor-col-resize",
  bottom: "cursor-row-resize",
  corner: "cursor-nwse-resize",
};

const AREA: Record<SidecarHandlePosition, string> = {
  // 左边缘：约 8px 命中带，覆盖面板全高（视觉透明，hover 时浅色提示）
  left: "absolute left-0 top-0 bottom-0 w-2",
  // 底边缘：约 8px 命中带，覆盖面板全宽
  bottom: "absolute bottom-0 left-0 right-0 h-2",
  // 左下角：18×18 角落，可同时调宽高
  corner: "absolute bottom-0 left-0 w-[18px] h-[18px]",
};

/**
 * Sidecar resize handle（pointer 事件实现，无第三方依赖）。
 * - delta 语义：相对 pointerdown 起点（不累计中间帧）
 * - 拖拽期间禁止文本选择（body user-select none + preventDefault）
 * - unmount cleanup：拖拽中关闭/unmount 时恢复 userSelect（只恢复由本 handle 设置的值）
 */
export function KiroSidecarResizeHandle({
  position,
  onResizeStart,
  onResize,
  onResizeEnd,
  className,
}: {
  position: SidecarHandlePosition;
  /** pointerdown：父级 snapshot drag origin size */
  onResizeStart?: () => void;
  /** 拖拽中实时增量（相对 pointerdown 起点） */
  onResize: (delta: { deltaWidth: number; deltaHeight: number }) => void;
  onResizeEnd?: () => void;
  /** 额外响应式 class（如 mobile 隐藏） */
  className?: string;
}) {
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const prevBodyUserSelectRef = useRef("");

  const restoreUserSelect = useCallback(() => {
    // 只恢复由当前 resize 设置的状态（若已被其它 interaction 改值则不覆盖）
    if (document.body.style.userSelect === "none") {
      document.body.style.userSelect = prevBodyUserSelectRef.current;
    }
  }, []);

  // unmount cleanup：拖拽中关闭 Sidecar 也必须恢复文本选择
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
    onResizeEnd?.();
  }, [onResizeEnd, restoreUserSelect]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      onResizeStart?.();
      startRef.current = { x: e.clientX, y: e.clientY };
      prevBodyUserSelectRef.current = document.body.style.userSelect;
      document.body.style.userSelect = "none";
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [onResizeStart]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const start = startRef.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      onResize({
        // 左边缘：向左拉（dx<0）→ 更宽；底边：向下拉（dy>0）→ 更高；corner 两者同时
        deltaWidth: position === "bottom" ? 0 : -dx,
        deltaHeight: position === "left" ? 0 : dy,
      });
    },
    [onResize, position]
  );

  return (
    <div
      role="separator"
      aria-label={position === "left" ? "调整宽度" : position === "bottom" ? "调整高度" : "调整尺寸"}
      data-sidecar-resize-handle={position}
      className={cn(
        "absolute z-20 touch-none select-none",
        AREA[position],
        CURSOR[position],
        "hover:bg-line/30 transition-colors",
        position === "corner" && "rounded-bl-[28px]",
        className
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
    />
  );
}
