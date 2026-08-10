"use client";

import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * Timeline Floating Detail（Portal + fixed）：anchored popover 的统一实现。
 * - createPortal(document.body) + position:fixed → 脱离 Course Card / overflow 容器
 * - Collision Detection：按真实 anchor/popover/workspace 矩形选择 placement，再 clamp
 * - bounds = Timeline Workspace ∩ Viewport，内边距 10px
 * - Esc 关闭；mouseenter/leave 转发（调用方实现 hover bridge）
 */

export type FloatingDetailKind = "marker" | "interval";

type Direction = "right" | "left" | "bottom" | "top";

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const GAP = 8;
const PADDING = 10;

function computePlacement(
  anchor: DOMRect,
  w: number,
  h: number,
  bounds: Bounds,
  preferred: Direction[]
): { x: number; y: number } {
  const candidates: Direction[] = [...preferred];
  for (const dir of candidates) {
    let x: number;
    let y: number;
    if (dir === "right") {
      x = anchor.right + GAP;
      y = anchor.top;
    } else if (dir === "left") {
      x = anchor.left - GAP - w;
      y = anchor.top;
    } else if (dir === "bottom") {
      x = anchor.left;
      y = anchor.bottom + GAP;
    } else {
      x = anchor.left;
      y = anchor.top - GAP - h;
    }
    const clampedX = Math.min(Math.max(x, bounds.minX), Math.max(bounds.minX, bounds.maxX - w));
    const clampedY = Math.min(Math.max(y, bounds.minY), Math.max(bounds.minY, bounds.maxY - h));
    if (clampedX === x && clampedY === y) {
      return { x, y };
    }
    // 候选不完全可见 → 记住 clamp 结果，继续尝试下一个方向
    if (dir === candidates[candidates.length - 1]) {
      return { x: clampedX, y: clampedY };
    }
  }
  return { x: bounds.minX, y: bounds.minY };
}

export function FloatingTimelineDetail({
  anchorRef,
  boundsRef,
  open,
  kind,
  ariaLabel,
  onRequestClose,
  onMouseEnter,
  onMouseLeave,
  children,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  boundsRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  kind: FloatingDetailKind;
  ariaLabel?: string;
  onRequestClose: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const anchor = anchorRef.current;
    const boundsEl = boundsRef.current;
    const pop = popRef.current;
    if (!anchor || !boundsEl || !pop) return;

    const ar = anchor.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    const br = boundsEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const bounds: Bounds = {
      minX: Math.max(br.left, 0) + PADDING,
      minY: Math.max(br.top, 0) + PADDING,
      maxX: Math.min(br.right, vw) - PADDING,
      maxY: Math.min(br.bottom, vh) - PADDING,
    };
    const preferred: Direction[] = kind === "marker" ? ["right", "left", "bottom", "top"] : ["bottom", "top"];
    const next = computePlacement(ar, pr.width, pr.height, bounds, preferred);
    setPos(next);
  }, [open, kind, anchorRef, boundsRef]);

  // Esc 关闭
  useLayoutEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onRequestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onRequestClose]);

  if (!open) return null;

  return createPortal(
    <div
      ref={popRef}
      role="dialog"
      aria-label={ariaLabel}
      data-testid="floating-timeline-detail"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        "fixed z-[70] bg-surface border border-line-strong rounded-[13px] shadow-card",
        "transition-opacity duration-[var(--motion-fast)]",
        pos ? "opacity-100" : "opacity-0"
      )}
      style={{
        left: pos?.x ?? -9999,
        top: pos?.y ?? -9999,
        width: 232,
        maxWidth: "min(260px, calc(100vw - 24px))",
        pointerEvents: "auto",
      }}
    >
      {children}
    </div>,
    document.body
  );
}
