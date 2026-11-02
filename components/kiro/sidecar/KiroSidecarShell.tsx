"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { X, Minus, PictureInPicture2 } from "lucide-react";
import { useKiroSessionActions, type KiroSidecarMode } from "@/components/kiro/KiroSessionProvider";
import { KiroMark } from "@/components/kiro/KiroHeader";
import { KiroSessionActions } from "@/components/kiro/KiroSessionActions";
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
 * Kiro Sidecar Shell（UX V2 + V2.1 correctness + Move V1 + Capsule Polish）：
 * - 非模态浮动面板（md+ 圆角 + shadow），无 backdrop，面板外可继续操作
 * - 进入/退出动画：usePresence（由 KiroSidecar host 唯一拥有；Shell 仅消费 present）
 * - Esc 可关闭；不点击外部关闭
 * - 尺寸：左边缘调宽 + 底边调高 + 左下角 handle；min/max + viewport clamp；持久化
 *   - 键盘等价（S6）：三把手 tabindex + 方向键 discrete（16px/Shift 64px），
 *     Move 把手聚焦 + 方向键（24px/Shift 96px）；走同一 clamp + 持久化路径
 * - <768 策略（S6-3）：全屏（inset-0 无圆角），resize/move 把手 hidden md:block 不渲染，
 *   几何手势无意义（无处可移/可调）；关闭/最小化按钮即等价出口（触屏点按 = pointer 事件统一处理）
 * - 位置（Move V1 + Desktop Polish）：顶部中央 hover-reveal 把手拖拽；top/right 表示；
 *   左/右/底 ≥24px、顶 ≥40px（--titlebar-h 26 + 14 safe gap，md+ 统一几何原则）；
 *   持久化；close/reopen 与 refresh 均保留；resize 与 position 共同遵守 geometry invariant
 * - viewport resize 的 clamp 仅 presentation（不写 Preferences；用户 drag commit 才持久化）
 *
 * V2.1 修复：
 * 1. Single mount：同一 Shell DOM 用 responsive CSS（mobile full-screen ↔ desktop floating），
 *    `{children}` 只渲染一次（禁止双分支复制 KiroChatSurface）。
 * 2. Resize 以 drag origin snapshot 为基数（pointerdown 相对 delta 语义不变），
 *    latestDraftRef 保证最后一帧 pointermove 的 size 被持久化（防 React state batching stale）。
 *
 * Move V1：
 * - 提交态位置用 CSS variables（top/right）；手势进行中视觉走 compositor transform，
 *   松手清零（presence motion 只在 mount/unmount 时跑，与手势不重叠，故无冲突）
 * - Move 与 Resize 共享 interactionRef 互斥；手势帧直接写 DOM，pointerup 一次性持久化
 * - Presence 单 ownership：mount/unmount 仅由 KiroSidecar host 的 usePresence 负责
 *
 * Drag Perf（帧率优化，与上述语义完全兼容）：
 * - Shell 内容经 memo 隔离：手势帧只重渲染 Shell 外框（CSS 变量），不再 reconcile 聊天树
 *   （children 元素在 host 不重渲染时引用稳定；mode/presence 在手势期间冻结）
 * - pointermove 经 rAF 合并为最多 1 次/帧（delta 相对 pointerdown 起点，latest-wins）
 * - Move 手势中视觉走 compositor transform（top/right 变量保持 committed），松手清零并持久化；
 *   Resize 走 CSS 变量直写（尺寸变化本来就需要 layout），同样跳过 React state
 * - commit 语义不变：latestDraftRef 保证最后一帧被持久化（防 batching stale）
 */
/**
 * 手势帧内容隔离：Shell 外框每帧重渲染（CSS 变量/transform），但聊天子树跳过。
 * children 元素在 host 不重渲染时引用稳定（手势期间 mode/presence 冻结），memo 直接 bail out。
 */
const SidecarShellContent = React.memo(function SidecarShellContent({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{children}</div>;
});

export function KiroSidecarShell({
  mode,
  present,
  children,
}: {
  mode: KiroSidecarMode;
  present: boolean;
  children: React.ReactNode;
}) {
  const { closeSidecar, expandSidecar, minimizeSidecar } = useKiroSessionActions();
  const sidecarSize = useKiroPreferencesStore((s) => s.sidecarSize);
  const setSidecarSize = useKiroPreferencesStore((s) => s.setSidecarSize);
  const sidecarPosition = useKiroPreferencesStore((s) => s.sidecarPosition);
  const setSidecarPosition = useKiroPreferencesStore((s) => s.setSidecarPosition);

  // viewport 跟踪（clamp 仅 presentation，resize 不写 Preferences）
  const [viewport, setViewport] = useState(() => ({
    width: typeof window !== "undefined" ? window.innerWidth : 1280,
    height: typeof window !== "undefined" ? window.innerHeight : 800,
  }));
  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // 拖拽中的草稿（size + position）：实时更新显示，pointerup 时一次性持久化（resize 不持久化）
  const [draft, setDraft] = useState<SidecarSize | null>(null);
  const [draftPosition, setDraftPosition] = useState<SidecarPosition | null>(null);

  // 确定性几何：size → position（viewport clamp 仅 presentation；不自动写 store）
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
  // Drag Perf：rAF 合并 + DOM 直写所需的 refs（React state 只在 begin/commit 边界变化）
  const shellRef = useRef<HTMLDivElement | null>(null);
  const moveRafRef = useRef(0);
  const pendingMoveRef = useRef<{ deltaX: number; deltaY: number } | null>(null);
  const resizeRafRef = useRef(0);
  const pendingResizeRef = useRef<{ deltaWidth: number; deltaHeight: number } | null>(null);

  // unmount：取消未执行的帧回调（防 detached node 写 + 引用滞留）
  useEffect(() => {
    return () => {
      if (moveRafRef.current) cancelAnimationFrame(moveRafRef.current);
      if (resizeRafRef.current) cancelAnimationFrame(resizeRafRef.current);
      moveRafRef.current = 0;
      resizeRafRef.current = 0;
    };
  }, []);

  // Motion V1：geometry 交互期间降权内部 motion（intro/settle/popover transforms 近瞬时）
  const [geometryInteracting, setGeometryInteracting] = useState(false);

  // fullVisible / fullInteractive 语义（Present 单 ownership：host 的 present 决定 exit 动画）
  const fullVisible = mode === "open" && present;
  const fullInteractive = mode === "open" && present;

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
   *
   * Drag Perf：只记录最新 delta 并调度一帧；帧回调里直接写 CSS 变量，
   * 不经过 React state（手势帧零 reconcile，由 memo + 直接写 DOM 保证）。
   */
  /** 同步执行一次 pending resize（rAF 回调与 commit 共用，保证最后一帧不丢） */
  const flushResizeFrame = () => {
    const pending = pendingResizeRef.current;
    pendingResizeRef.current = null;
    if (!pending || interactionRef.current !== "resize") return;
    const origin = resizeOriginRef.current ?? size;
    const next = clampSidecarSizeAtPosition(
      {
        width: origin.width + pending.deltaWidth,
        height: origin.height + pending.deltaHeight,
      },
      position,
      viewport
    );
    latestDraftRef.current = next;
    const el = shellRef.current;
    if (el) {
      el.style.setProperty("--kiro-sidecar-width", `${next.width}px`);
      el.style.setProperty("--kiro-sidecar-height", `${next.height}px`);
    }
  };

  const applyDelta = (delta: { deltaWidth: number; deltaHeight: number }) => {
    if (interactionRef.current !== "resize") return;
    pendingResizeRef.current = delta;
    if (resizeRafRef.current) return;
    resizeRafRef.current = requestAnimationFrame(() => {
      resizeRafRef.current = 0;
      flushResizeFrame();
    });
  };

  /** pointerup / pointercancel：先同步 flush 最后一帧，再以 latestDraftRef 为准持久化 */
  const commitResize = () => {
    if (resizeRafRef.current) {
      cancelAnimationFrame(resizeRafRef.current);
      resizeRafRef.current = 0;
    }
    flushResizeFrame();
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

  /** 同步执行一次 pending move（rAF 回调与 commit 共用，保证最后一帧不丢） */
  const flushMoveFrame = () => {
    const pending = pendingMoveRef.current;
    pendingMoveRef.current = null;
    if (!pending || interactionRef.current !== "move") return;
    const origin = moveOriginRef.current ?? position;
    const next = clampSidecarPosition(
      {
        top: origin.top + pending.deltaY,
        right: origin.right - pending.deltaX,
      },
      size,
      viewport
    );
    latestDraftPositionRef.current = next;
    // Compositor-only 位移（相对 committed 几何的已应用增量；变量保持 committed，
    // React state 不动）。松手时清零 transform，持久化值与视觉完全一致，无跳变。
    const el = shellRef.current;
    if (el) {
      el.style.transform = `translate(${origin.right - next.right}px, ${next.top - origin.top}px)`;
    }
  };

  const applyMove = (delta: { deltaX: number; deltaY: number }) => {
    if (interactionRef.current !== "move") return;
    pendingMoveRef.current = delta;
    if (moveRafRef.current) return;
    moveRafRef.current = requestAnimationFrame(() => {
      moveRafRef.current = 0;
      flushMoveFrame();
    });
  };

  const commitMove = () => {
    if (moveRafRef.current) {
      cancelAnimationFrame(moveRafRef.current);
      moveRafRef.current = 0;
    }
    flushMoveFrame();
    if (interactionRef.current === "move") {
      // 确定性落位：松手位置 = 手指位置（clamped），无投射、无惯性、无边角吸附；
      // 惯性投射已下线（曾按松手速度瞬移 ≤200px 再 clamp，普通速度松手即触发，
      // 视觉上就是“被吸到边角”；真惯性需要动画循环 + settle，不在此做）。
      const finalPosition = latestDraftPositionRef.current;
      if (finalPosition) {
        // 闪回修复：先把终点同步直写 CSS 变量、再清零视觉位移（同一 tick 内完成，
        // 无“旧位置闪一帧”窗口；随后持久化触发的 React 重绘写入完全相同的值）。
        // 此前顺序反了（先清 transform、等 React 提交新变量），松手后会瞬间弹回起点。
        const el = shellRef.current;
        if (el) {
          el.style.setProperty("--kiro-sidecar-top", `${finalPosition.top}px`);
          el.style.setProperty("--kiro-sidecar-right", `${finalPosition.right}px`);
          el.style.transform = "";
          // 松手跳修复（时序陷阱）：transition 的启停按“后置样式”判定——
          // 属性移除（transition:none → 230ms）与上面的数值变更若落在同一次样式重算，
          // 过渡会照常启动（transform translate→none 跑 230ms spring = 闪一下又回来）。
          // 此处强制同步重排，把“数值落地”与“过渡恢复”（下面的 setState 重渲染摘掉属性）
          // 隔进两次样式重算：第一次 transition:none 生效、无过渡；第二次数值已无变化、
          // 无可过渡。一次手势仅一次同步布局，开销可忽略。
          void el.offsetWidth;
        }
        setSidecarPosition(finalPosition);
      }
      interactionRef.current = "idle";
    }
    moveOriginRef.current = null;
    latestDraftPositionRef.current = null;
    setDraftPosition(null);
    setGeometryInteracting(false);
  };

  // Final Closure：fullVisible = open && present；closed exit 时保持 hidden 不闪回
  return (
    <div
      ref={shellRef}
      data-testid="kiro-sidecar"
      data-state={mode}
      data-geometry-interacting={geometryInteracting || undefined}
      role="dialog"
      aria-label="Kiro 侧边聊天"
      aria-hidden={!fullInteractive}
      {...(!fullInteractive ? ({ inert: "" } as unknown as React.HTMLAttributes<HTMLDivElement>) : {})}
      className={cn(
        // kiro-sidecar-shell：geometry 交互期间由 CSS 关闭根自身 transition
        //（拖动逐帧直写 transform；若 230ms spring 介入插值 → 滞后光标，松手残余一次性结算 = 松手跳）
        "kiro-sidecar-shell fixed z-sidecar flex flex-col bg-surface overflow-hidden",
        "inset-0 w-full h-full rounded-none pb-[env(safe-area-inset-bottom)]",
        "md:inset-auto md:top-[var(--kiro-sidecar-top)] md:right-[var(--kiro-sidecar-right)]",
        "md:w-[var(--kiro-sidecar-width)] md:h-[var(--kiro-sidecar-height)] md:rounded-[28px] md:border md:border-line md:shadow-card",
        fullVisible
          ? "opacity-100 scale-100 translate-x-0 translate-y-0 pointer-events-auto"
          : "opacity-0 scale-[0.985] pointer-events-none -translate-y-1 md:translate-x-1",
        fullVisible
          // 进入走 spring（空间位移自然 settle；退出仍加速离场）
          ? "transition-[opacity,transform] duration-[var(--motion-panel)] ease-[var(--ease-spring)]"
          : "transition-[opacity,transform] duration-[var(--motion-exit-panel)] ease-[var(--ease-exit)]"
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
      {/* Move handle：md+ 顶部中央 hover-reveal（S6-2 聚焦亦显现 + 方向键，进 Tab order） */}
      <KiroSidecarMoveHandle
        onMoveStart={beginMove}
        onMove={applyMove}
        onMoveEnd={commitMove}
        className="hidden md:block"
      />
      <KiroSidecarHeader onMinimize={minimizeSidecar} onExpand={expandSidecar} onClose={closeSidecar} />
      <SidecarShellContent>{children}</SidecarShellContent>

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

function MiniPopoutButton() {
  // window.classflowDesktop 只经 lib/desktop/bridge.ts 访问（本模块不直触 global）
  const [showMini, setShowMini] = useState<(() => void) | null>(null);
  useEffect(() => {
    let cancelled = false;
    import("@/lib/desktop/bridge").then(({ getClassFlowDesktopMiniBridge }) => {
      if (cancelled) return;
      const mini = getClassFlowDesktopMiniBridge();
      if (mini) setShowMini(() => () => mini.show());
    });
    return () => {
      cancelled = true;
    };
  }, []);
  if (!showMini) return null;
  return (
    <button
      type="button"
      onClick={() => {
        try {
          showMini();
        } catch {}
      }}
      aria-label="弹出迷你聊天窗"
      className="hidden md:flex w-8 h-8 items-center justify-center rounded-xl text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
      data-testid="kiro-sidecar-mini-popout"
    >
      <PictureInPicture2 className="w-4 h-4" />
    </button>
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
      {/* 右侧收敛为 4 键：分享 / 更多（含新对话与打开完整工作区）/ 最小化 / 关闭；
          独立 Expand 按钮与 More 菜单重复，已移除 */}
      <div className="flex items-center gap-1 shrink-0">
        <KiroSessionActions variant="sidecar" onExpand={onExpand} />
        {/* Kiro Mini 常驻窗（桌面端）：独立置顶小窗（可拖动/调尺寸/文件拖入）；非桌面端不渲染 */}
        <MiniPopoutButton />
        <button
          onClick={onMinimize}
          aria-label="最小化 Kiro"
          className="hidden md:flex w-8 h-8 items-center justify-center rounded-xl text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
          data-testid="kiro-sidecar-minimize"
        >
          <Minus className="w-4 h-4" />
        </button>
        <button
          onClick={onClose}
          aria-label="关闭 Kiro"
          className="w-8 h-8 flex items-center justify-center rounded-xl text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
