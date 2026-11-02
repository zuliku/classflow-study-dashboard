"use client";

import React from "react";
import { createPortal } from "react-dom";
import { RotateCcw } from "lucide-react";
import { PopoverPanel } from "@/components/ui/Popover";
import { usePresence } from "@/lib/usePresence";
import { MOTION_EXIT_MS } from "@/lib/motion";
import { KiroReasoningIcon } from "@/components/kiro/KiroReasoningIcon";
import { KiroReasoningEffort, ReasoningCapability } from "@/lib/ai/reasoning/types";
import {
  isComposerReasoningAdjustable,
  reasoningEffortLabel,
  reasoningStepIndex,
} from "@/components/kiro/composer/KiroComposerModel";
import { cn } from "@/lib/utils";

/**
 * Kiro Composer — Reasoning（Codex-style 分段选择）。
 *
 * - 一级：`🧠 高`（default → `🧠 默认`；compact → 仅图标）
 * - 弹层：当前档位 + 模型名 + 分段轨道；**点击档位即选中（不关闭弹窗）**，不做拖拽放置
 * - 轨道为 flex 分段（无绝对定位溢出 → 不出现滚动条 / 不被裁剪）
 * - 小窗（Sidecar / compact）：弹窗 Portal 到 body，右对齐 trigger + viewport clamp，
 *   避免被 Sidecar 的 overflow-hidden 裁切；桌面仍使用原锚点居中。
 * - Reasoning 是 Model preference：与 Computer 开关无关；模型 fixed → 不渲染
 * - 最高档：填充层上叠加流动彩条（opacity crossfade 进出，变色不生硬；reduced-motion 静止保彩）
 */
/** 弹窗固定宽度（w-64 = 256px）：用于锚点精确居中 */
const KiroComposerReasoningControlWIDTH = 256;

/** knob 直径（w-8 = 32px）：最高档时贴右端（右边缘 = 轨道右边缘） */
const KNOB_SIZE = 32;

/** 小窗（Sidecar）Portal 定位：右对齐 trigger + viewport clamp，避免被 overflow-hidden 裁切 */
interface CompactPanelLayout {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
  maxHeight: number;
}
const COMPACT_PANEL_WIDTH = 256;
const COMPACT_PANEL_MAX_HEIGHT = 320;

export function KiroComposerReasoningControl({
  capability,
  effort,
  modelName,
  disabled,
  compact,
  onChange,
  open: openProp,
  onOpenChange,
}: {
  capability?: ReasoningCapability | null;
  effort: KiroReasoningEffort;
  modelName: string;
  disabled?: boolean;
  compact?: boolean;
  onChange: (effort: KiroReasoningEffort) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = openProp ?? internalOpen;
  // 拖动状态（hooks 必须在早退前，保持顺序稳定）
  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const pointerActiveRef = React.useRef(false);
  const [dragging, setDragging] = React.useState(false);
  const setOpen = React.useCallback(
    (next: boolean) => {
      onOpenChange?.(next);
      if (openProp === undefined) setInternalOpen(next);
    },
    [onOpenChange, openProp]
  );
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const [compactLayout, setCompactLayout] = React.useState<CompactPanelLayout | null>(null);
  const compactPresence = usePresence(!!open && !!compact, MOTION_EXIT_MS.panel);

  const measureCompact = React.useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(COMPACT_PANEL_WIDTH, vw - 24);
    // 小窗靠右：面板右边缘对齐 trigger 右边缘，空间不足时 clamp 到 viewport
    const left = Math.max(12, Math.min(rect.right - width, vw - width - 12));
    const spaceAbove = rect.top - 12;
    const spaceBelow = vh - rect.bottom - 12;
    const placeAbove = spaceAbove >= 180 || spaceAbove >= spaceBelow;
    const maxHeight = Math.max(140, Math.min(COMPACT_PANEL_MAX_HEIGHT, placeAbove ? spaceAbove : spaceBelow));
    setCompactLayout({
      left,
      width,
      maxHeight,
      ...(placeAbove
        ? { bottom: vh - rect.top + 6 }
        : { top: rect.bottom + 6 }),
    });
  }, []);

  React.useLayoutEffect(() => {
    if (!open || !compact) return;
    measureCompact();
  }, [open, compact, measureCompact]);

  React.useEffect(() => {
    if (!open || !compact) return;
    const onResize = () => measureCompact();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, compact, measureCompact]);

  if (!isComposerReasoningAdjustable(capability) || !capability) return null;

  const steps = capability.supportedEfforts;
  const activeIndex = reasoningStepIndex(steps, effort);
  // 最高档：填充到轨道右端（不留右侧空余），knob 贴右端（右边缘 = 轨道右边缘）
  const atMax = steps.length > 1 && activeIndex === steps.length - 1;
  const stepCenterPercent = ((activeIndex + 0.5) / steps.length) * 100;
  const fillPercent = atMax ? 100 : stepCenterPercent;
  const knobLeft = atMax ? `calc(100% - ${KNOB_SIZE / 2}px)` : `${stepCenterPercent}%`;

  const commit = (step: KiroReasoningEffort) => {
    if (step !== effort) onChange(step);
  };

  /**
   * 拖动调整（Pointer Events；轨道级单一 owner）：
   * - pointerdown 只记录按下；首次 pointermove 进入 dragging（仅作 data 标记）
   * - pointermove 持续按 x 换算档位；同档位不重复触发
   * - knob/fill 始终保留过渡（单击与拖动都在档位间平滑滑动）
   * - 无坐标（合成事件 / 无法测量）→ 不做换算（仍由档位按钮的 pointerdown 精确落地）
   */
  const commitAtClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    if (typeof clientX !== "number" || !Number.isFinite(clientX)) return;
    const rect = el.getBoundingClientRect();
    if (!Number.isFinite(rect.width) || rect.width <= 0) return;
    const ratio = (clientX - rect.left) / rect.width;
    const index = Math.max(0, Math.min(steps.length - 1, Math.floor(ratio * steps.length)));
    const step = steps[index];
    if (step) commit(step);
  };

  const handleTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    // 不冒泡到 Composer outside-click（弹窗保持打开）
    e.stopPropagation();
    pointerActiveRef.current = true;
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* jsdom / 旧引擎无 pointer capture：不影响点击路径 */
    }
    commitAtClientX(e.clientX);
  };

  const handleTrackPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointerActiveRef.current || disabled) return;
    if (!dragging) setDragging(true);
    commitAtClientX(e.clientX);
  };

  const handleTrackPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    pointerActiveRef.current = false;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      /* 无 capture 时忽略 */
    }
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (disabled) return;
          setOpen(!open);
        }}
        aria-label="思考程度"
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={disabled}
        data-testid="kiro-composer-reasoning"
        className={cn(
          "flex items-center h-9 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
          // 宽度固定（compact w-9 / 完整 w-16）：档位 label 变化不改变几何 → 按钮与弹窗不横移
          compact
            ? cn(
                "w-9 justify-center",
                open ? "bg-alabaster text-charcoal" : "text-sandrift hover:bg-alabaster hover:text-charcoal"
              )
            : cn(
                "w-16 justify-center gap-1.5 text-[11px] font-semibold",
                open
                  ? "bg-alabaster text-charcoal border border-line-strong"
                  : "text-sandrift border border-transparent hover:bg-alabaster hover:text-charcoal"
              )
        )}
      >
        <KiroReasoningIcon className="w-3.5 h-3.5 shrink-0" />
        {/* 固定 label 槽位（最长「超高 / 极低」= 2 字）：切换档位时宽度不变 */}
        {!compact && (
          <span className="w-6 text-center truncate" data-testid="kiro-composer-reasoning-label">
            {reasoningEffortLabel(effort)}
          </span>
        )}
      </button>

      {/* 弹窗：桌面保持锚点居中；小窗（Sidecar/compact）Portal 到 body，右对齐 + viewport clamp，
          避免被 Sidecar 的 overflow-hidden 裁切。 */}
      {(() => {
        const popover = (
          <PopoverPanel
            open={open}
            placement="anchor"
            motionProfile="kiro"
            className="pointer-events-auto w-64 max-w-[calc(100vw-24px)] overflow-hidden"
            style={
              compact && compactLayout
                ? {
                    position: "fixed",
                    zIndex: 110,
                    left: compactLayout.left,
                    top: compactLayout.top,
                    bottom: compactLayout.bottom,
                    width: compactLayout.width,
                    maxHeight: compactLayout.maxHeight,
                    margin: 0,
                  }
                : { left: "50%", bottom: "100%", marginLeft: -(KiroComposerReasoningControlWIDTH / 2), marginBottom: 6 }
            }
          >
          <div className="p-3" data-testid="kiro-composer-reasoning-menu" role="dialog" aria-label="思考程度">
            <div className="flex items-center gap-2">
              <KiroReasoningIcon className="w-3.5 h-3.5 text-sandrift shrink-0" />
              <span className="flex-1 text-center text-xs font-bold text-charcoal">
                {reasoningEffortLabel(steps[activeIndex] ?? effort)}
              </span>
              <button
                type="button"
                onClick={() => commit("default")}
                disabled={effort === "default"}
                aria-label="恢复默认思考程度"
                className="p-1 rounded-md text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="mt-0.5 text-center text-[10px] text-sandrift truncate">{modelName}</p>

            {/* 分段轨道（Codex-style）：点击 / 拖动调整；白色 knob 指示当前档位（恒在轨道内，不溢出） */}
            <div
              ref={trackRef}
              role="radiogroup"
              aria-label="思考程度"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" && activeIndex > 0) {
                  e.preventDefault();
                  commit(steps[activeIndex - 1]);
                }
                if (e.key === "ArrowRight" && activeIndex < steps.length - 1) {
                  e.preventDefault();
                  commit(steps[activeIndex + 1]);
                }
              }}
              onPointerDown={handleTrackPointerDown}
              onPointerMove={handleTrackPointerMove}
              onPointerUp={handleTrackPointerEnd}
              onPointerCancel={handleTrackPointerEnd}
              data-testid="kiro-composer-reasoning-track"
              data-dragging={dragging ? "true" : undefined}
              data-max={atMax || undefined}
              className="relative mt-2 h-9 rounded-full bg-alabaster overflow-hidden touch-none focus:outline-none focus-visible:ring-1 focus-visible:ring-line-strong"
            >
              {/* 填充：到当前档位中心；最高档填满整条轨道（直边 + 轨道裁剪，窄档位不变形）；
                  拖动过程中同样保留 width 过渡（档位间平滑滑动，不瞬跳） */}
              <span
                aria-hidden="true"
                data-testid="kiro-composer-reasoning-fill"
                className="absolute inset-y-0 left-0 bg-pastel-mint transition-[width] duration-[var(--kiro-motion-control,var(--motion-fast))] ease-[var(--ease-standard)]"
                style={{ width: `${fillPercent}%` }}
              />
              {/* 最高档流动彩条：与底填充同宽同位，opacity 500ms 柔光晕染进出
                  （显隐比几何过渡慢半拍以上，变色不生硬）；内层 200% 宽彩带做 translateX 位移
                  （compositor 合成；位移恰为一个色带周期，首尾帧一致，无缝不断档）；
                  reduced-motion 下静止但保留彩色 */}
              <span
                aria-hidden="true"
                data-testid="kiro-composer-reasoning-flow"
                className={cn(
                  "absolute inset-y-0 left-0 overflow-hidden kiro-reasoning-flow-fade",
                  atMax ? "opacity-100" : "opacity-0"
                )}
                style={{ width: `${fillPercent}%` }}
              >
                <span
                  aria-hidden="true"
                  data-testid="kiro-composer-reasoning-flow-strip"
                  className="block h-full w-[200%] kiro-reasoning-flow"
                />
              </span>
              {/* 档位点：未选中显示小点（固定位置标记，保持原尺寸）；选中位置由 knob 表达 */}
              {steps.map((step, index) =>
                index === activeIndex ? null : (
                  <span
                    key={step}
                    aria-hidden="true"
                    data-testid="kiro-composer-reasoning-dot"
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-sandrift/50"
                    style={{ left: `${((index + 0.5) / steps.length) * 100}%` }}
                  />
                )
              )}
              {/* 白色 knob（滑块点）：位置 = 当前档位中心；最高档贴右端（静态，无 hover 位移）；
                  拖动过程中同样保留 left 过渡（平滑跟到目标档位） */}
              <span
                aria-hidden="true"
                data-testid="kiro-composer-reasoning-knob"
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-surface border border-line shadow-subtle transition-[left] duration-[var(--kiro-motion-control,var(--motion-fast))] ease-[var(--ease-standard)]"
                style={{ left: knobLeft }}
              />
              {/* 可点击段：每档一个（点击 / 键盘选中；拖动由轨道级 Pointer 处理统一负责） */}
              <div className="absolute inset-0 flex">
                {steps.map((step, index) => {
                  const selected = index === activeIndex;
                  return (
                    <button
                      key={step}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={`思考程度：${reasoningEffortLabel(step)}`}
                      // pointerdown 即生效（精确档位；不 stopPropagation → 轨道同时开始拖动）
                      onPointerDown={() => commit(step)}
                      onClick={() => commit(step)}
                      className="flex flex-1 min-w-0 items-center justify-center rounded-full focus:outline-none focus-visible:ring-1 focus-visible:ring-line-strong"
                    >
                      <span className="sr-only">{reasoningEffortLabel(step)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          </PopoverPanel>
        );

        if (compact) {
          return compactPresence.mounted && compactLayout && typeof document !== "undefined"
            ? createPortal(
                <div
                  data-kiro-composer-menu="reasoning"
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  {popover}
                </div>,
                document.body
              )
            : null;
        }

        return (
          <span
            aria-hidden="true"
            data-testid="kiro-composer-reasoning-anchor"
            className="pointer-events-none"
            style={{ position: "absolute", left: 18, top: 0, width: 0, height: 0 }}
          >
            {popover}
          </span>
        );
      })()}
    </div>
  );
}
