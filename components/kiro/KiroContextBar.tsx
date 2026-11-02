"use client";

import React, { useEffect, useRef, useState } from "react";
import { BookOpen, CalendarClock, ClipboardCheck, FileText, Users, X } from "lucide-react";
import { KiroContextRef } from "@/lib/ai/context/types";
import {
  describeKiroContextRef,
  formatKiroContextDisplayLabel,
  getKiroContextVisualRole,
  splitKiroContextsForDisplay,
} from "@/lib/ai/context/presentation";
import { useEnterOnAdd } from "@/lib/useEnterOnAdd";
import { usePresence } from "@/lib/usePresence";
import { ExitCollapse } from "@/components/ui/ExitCollapse";
import { MOTION_EXIT_MS } from "@/lib/motion";
import { useInertOnHidden } from "@/lib/useInertOnHidden";
import { useEffectiveReducedMotion } from "@/hooks/useEffectiveReducedMotion";
import { cn } from "@/lib/utils";

/** Ambient（自动环境）kind 图标：只用 Lucide（week 用弱时间感 Clock 系，不再用 @ / 文字方块） */
const AMBIENT_KIND_ICONS: Record<KiroContextRef["kind"], React.ComponentType<{ className?: string }>> = {
  week: CalendarClock,
  course: BookOpen,
  assignment: ClipboardCheck,
  "group-project": Users,
  material: FileText,
  artifact: FileText,
};

/**
 * Kiro Context Strip（Task 7E）：Composer 上方的一条轻环境信息。
 * - 无 expand/collapse 状态，直接渲染 active Contexts
 * - Ambient Capsule（auto）：极浅底 + 弱时间/环境图标，× 仅 hover/focus 显示
 * - Manual Token（manual / entry）：更明确的用户 token，× 常显
 * - 展示数量：Desktop ambient 1 + manual 2；compact 1 + 1；其余进 +N（唯一管理入口）
 * - 纯展示组件：不获取数据 / 不构建 Prompt / 不读 Store
 */
export function KiroContextBar({
  contexts,
  onRemove,
  compact,
  locked = false,
  leading,
}: {
  contexts: KiroContextRef[];
  onRemove: (key: string) => void;
  /** sidecar：更紧凑（ambient 1 + manual 1） */
  compact?: boolean;
  /** 当前回复使用已冻结的 Context Snapshot；修改留给下一条消息。 */
  locked?: boolean;
  /** 前缀 slot：Workspace / Sandbox 等「当前 Kiro 正在处理什么」的轻量指示，与 context 胶囊同一 strip */
  leading?: React.ReactNode;
}) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowBtnRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const enteringContextKeys = useEnterOnAdd(contexts.map((context) => context.key));
  const overflowPresence = usePresence(overflowOpen, MOTION_EXIT_MS.fast);
  const overflowInertRef = useInertOnHidden<HTMLDivElement>(!overflowPresence.visible);
  // P2：chip 移除原位 collapse（160ms 后真正删除；外部整单替换直接卸载，不过渡）。
  const reducedMotion = useEffectiveReducedMotion();
  const [leavingKeys, setLeavingKeys] = useState<ReadonlySet<string>>(new Set());
  const leavingTimersRef = useRef<number[]>([]);
  useEffect(
    () => () => {
      leavingTimersRef.current.forEach((t) => window.clearTimeout(t));
      leavingTimersRef.current = [];
    },
    []
  );
  const handleRemove = (key: string) => {
    if (locked || leavingKeys.has(key)) return;
    if (reducedMotion) {
      onRemove(key);
      return;
    }
    setLeavingKeys((prev) => new Set(prev).add(key));
    const timer = window.setTimeout(() => {
      leavingTimersRef.current = leavingTimersRef.current.filter((t) => t !== timer);
      setLeavingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      onRemove(key);
    }, MOTION_EXIT_MS.panel);
    leavingTimersRef.current.push(timer);
  };

  // +N Popover：outside click / Esc 关闭（非 modal，不拦截原事件）
  useEffect(() => {
    if (!overflowOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (overflowBtnRef.current?.contains(t) || popoverRef.current?.contains(t)) return;
      setOverflowOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOverflowOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [overflowOpen]);

  const { visibleAmbient, visibleManual, overflow } = splitKiroContextsForDisplay(contexts, !!compact);
  const allForPopover = [...visibleAmbient, ...visibleManual, ...overflow];

  // 整条 presence（仅退出补折叠）：删最后一项时与 chip 并行收（同 composer shelf 语义），
  // 而非瞬间卸载顶起输入区。进入不播放（首帧即有内容时直接渲染，chip 各自 animate-enter）。
  // reduced-motion 下瞬间落位（无动画即正确）。
  const hasVisible = allForPopover.some((c) => !leavingKeys.has(c.key)) || !!leading;
  const [renderBar, setRenderBar] = useState(hasVisible);
  const [barExiting, setBarExiting] = useState(false);
  useEffect(() => {
    if (reducedMotion) {
      setRenderBar(hasVisible);
      setBarExiting(false);
      return;
    }
    if (hasVisible) {
      setRenderBar(true);
      setBarExiting(false);
      return;
    }
    setBarExiting(true);
    const t = window.setTimeout(() => {
      setRenderBar(false);
      setBarExiting(false);
    }, MOTION_EXIT_MS.panel);
    return () => window.clearTimeout(t);
  }, [hasVisible, reducedMotion]);
  // 首帧无内容（且无 leading）直接不占位；退出播完后卸载
  if (!renderBar) return null;

  const removeButton = (c: KiroContextRef, revealOnHover: boolean) => (
    <button
      onClick={() => handleRemove(c.key)}
      disabled={locked}
      aria-label={`移除上下文：${formatKiroContextDisplayLabel(c)}`}
      className={cn(
        "p-0.5 rounded-full text-sandrift/80 hover:text-danger transition-colors shrink-0 disabled:opacity-35 disabled:cursor-not-allowed",
        revealOnHover &&
          "opacity-100 md:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
      )}
    >
      <X className="w-3 h-3" />
    </button>
  );

  return (
    // 整条折叠不能直接用 ExitCollapse：其内层常驻 overflow-hidden，会裁掉 +N 的
    // absolute popover（非 portal）。此处只在 exiting 期间裁剪，平时保持可见。
    <div
      className={cn(
        "grid ease-[var(--ease-exit)]",
        "transition-[grid-template-rows,opacity] duration-[var(--motion-exit-panel)]",
        barExiting
          ? "grid-rows-[0fr] opacity-0 pointer-events-none"
          : "grid-rows-[1fr] opacity-100"
      )}
    >
    <div className={cn("min-h-0", barExiting ? "overflow-hidden" : "overflow-visible")}>
    <div
      data-testid="kiro-context-bar"
      // 不能用 overflow-hidden：会裁剪 leading（Workspace）与 +N 的 absolute popover
      className={cn("flex flex-wrap items-center gap-1.5 pb-1.5", compact && "px-0.5")}
    >
      {/* Leading：Workspace / Sandbox 指示（先于 manual context 渲染） */}
      {leading}

      {/* Manual Token：用户显式 @ / Ask Kiro 实体入口（无图标，× 清晰）；移除走原位 collapse。
          自动上下文按产品决策不进胶囊（只进模型；开关在设置），此处无 ambient 渲染 */}
      {visibleManual.map((c) => (
        <ExitCollapse key={c.key} axis="horizontal" exiting={leavingKeys.has(c.key)} className="shrink-0">
            <span
              className={cn(
                "inline-flex items-center gap-1 pl-2.5 pr-1 h-7 max-w-[200px] rounded-full bg-alabaster/70 border border-line text-[11px] font-semibold text-charcoal shrink-0",
                enteringContextKeys.has(c.key) && "animate-enter"
              )}
            >
              <span className="truncate">{formatKiroContextDisplayLabel(c)}</span>
              {removeButton(c, false)}
            </span>
        </ExitCollapse>
      ))}

      {/* +N：唯一「查看剩余 Context」入口 */}
      {overflow.length > 0 && (
        <div className="relative shrink-0" ref={overflowBtnRef}>
          <button
            onClick={() => setOverflowOpen((v) => !v)}
            aria-label={`查看全部上下文，共 ${contexts.length} 项`}
            aria-expanded={overflowOpen}
            className="h-7 px-2 rounded-full text-[11px] font-semibold text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
          >
            +{overflow.length}
          </button>
          {overflowPresence.mounted && (
            <div
              ref={(el) => {
                popoverRef.current = el;
                overflowInertRef(el);
              }}
              role="dialog"
              aria-label="当前上下文"
              className={cn(
                "absolute left-0 bottom-full mb-1.5 w-[280px] max-h-[min(320px,50vh)] overflow-y-auto overflow-x-clip bg-surface border border-line-strong rounded-2xl shadow-card p-1.5 z-40 ux-inline origin-bottom-left transition-[opacity,transform]",
                overflowPresence.visible
                  ? "opacity-100 duration-[var(--motion-fast)]"
                  : "opacity-0 translate-y-[3px] scale-[0.99] pointer-events-none duration-[var(--motion-exit-fast)] ease-[var(--ease-exit)]"
              )}
            >
              <p className="px-2.5 pt-1.5 pb-1 text-[10px] font-bold text-sandrift">当前上下文</p>
              {allForPopover.map((c) => {
                const role = getKiroContextVisualRole(c);
                const Icon = role === "ambient" ? AMBIENT_KIND_ICONS[c.kind] : null;
                return (
                  <div
                    key={c.key}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-[11px]"
                  >
                    {Icon && <Icon className="w-3.5 h-3.5 text-sandrift shrink-0" />}
                    <span className="flex-1 min-w-0 truncate font-semibold text-charcoal">
                      {formatKiroContextDisplayLabel(c)}
                    </span>
                    {removeButton(c, false)}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
    </div>
    </div>
  );
}
