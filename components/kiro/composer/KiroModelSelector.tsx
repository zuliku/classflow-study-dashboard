"use client";

import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { ProviderLogo } from "@/components/kiro/ProviderLogo";
import { AIModelVendor } from "@/lib/ai/providers/types";
import { EASE_BEZIER, MOTION_EXIT_MS, MOTION_MS } from "@/lib/motion";
import { useEffectiveReducedMotion } from "@/hooks/useEffectiveReducedMotion";
import { useRestoreFocus } from "@/lib/useRestoreFocus";
import { cn } from "@/lib/utils";

/**
 * Kiro Model Selector（ChatGPT-style motion，保留原菜单 UI）
 *
 * 设计：docs/kiro-model-selector-glass.md
 * - 不改变原模型菜单的信息结构（模型标题 / 搜索 / 列表 / 设置入口），只增加玻璃表面与进退场动效。
 * - 不触发全局背景磨砂：没有 full-screen scrim / backdrop blur；面板自身保留 18px 玻璃模糊。
 * - 面板 Portal 到 body，避免 Composer / Sidecar 的 overflow 裁切；fixed + viewport clamp。
 * - 动效 180ms 进入 / 110ms 退出（比 220/160 略快），全部使用 Motion Contract token。
 * - reduced motion：无位移/缩放/模糊过渡，直接落最终态。
 * - 兼容 Composer 既有 outside-click：面板带 data-kiro-composer-menu。
 */

export interface KiroModelOption {
  value: string;
  label: string;
  vendor: AIModelVendor | null;
}

export interface KiroModelSelectorProps {
  modelOptions: KiroModelOption[];
  selectedModelId: string;
  activeModelName: string;
  activeModelVendor: AIModelVendor | null;
  /** 当前模型不在 Catalog（已下线/远端不可用） */
  modelUnavailable?: boolean;
  /** next-turn preference 锁 */
  disabled?: boolean;
  compact?: boolean;
  onSelectModel: (id: string) => void;
  onOpenSettings: () => void;
  /** 受控 open（Composer 单一菜单 ownership）；不传则内部自管 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 面板材质：生产默认 light；演示页可切换 dark。 */
  appearance?: "light" | "dark";
}

const PANEL_ENTER_S = MOTION_MS.base / 1000;
const PANEL_EXIT_S = MOTION_EXIT_MS.fast / 1000;
const PANEL_GAP = 6;
const PANEL_VIEWPORT_INSET = 12;
const PANEL_WIDTH = 256;
const PANEL_MAX_HEIGHT = 360;

interface PanelLayout {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
  maxHeight: number;
  placement: "top" | "bottom";
}

export function KiroModelSelector({
  modelOptions,
  selectedModelId,
  activeModelName,
  activeModelVendor,
  modelUnavailable,
  disabled,
  compact,
  onSelectModel,
  onOpenSettings,
  open: openProp,
  onOpenChange,
  appearance = "light",
}: KiroModelSelectorProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [layout, setLayout] = useState<PanelLayout | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  /** 只有键盘导航才自动滚动；鼠标 hover 不滚列表，避免下方选项 hover 时硬跳 */
  const activeScrollRef = useRef<"keyboard" | "pointer">("keyboard");
  const baseId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const listId = `kiro-model-list-${baseId}`;
  const panelId = `kiro-model-panel-${baseId}`;
  const reducedMotion = useEffectiveReducedMotion();

  const setOpen = useCallback(
    (next: boolean) => {
      onOpenChange?.(next);
      if (openProp === undefined) setInternalOpen(next);
    },
    [onOpenChange, openProp]
  );

  const q = query.trim().toLowerCase();
  const visibleModels = useMemo(
    () => (!q ? modelOptions : modelOptions.filter((m) => m.label.toLowerCase().includes(q))),
    [modelOptions, q]
  );
  const selectedIndex = useMemo(
    () => Math.max(0, visibleModels.findIndex((m) => m.value === selectedModelId)),
    [visibleModels, selectedModelId]
  );

  const optionId = useCallback((index: number) => `kiro-model-option-${baseId}-${index}`, [baseId]);

  const measure = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(PANEL_WIDTH, vw - PANEL_VIEWPORT_INSET * 2);
    const left = Math.max(
      PANEL_VIEWPORT_INSET,
      Math.min(rect.right - width, vw - width - PANEL_VIEWPORT_INSET)
    );
    const spaceAbove = rect.top - PANEL_GAP - PANEL_VIEWPORT_INSET;
    const spaceBelow = vh - rect.bottom - PANEL_GAP - PANEL_VIEWPORT_INSET;
    const wantsAbove = spaceAbove >= 220 || spaceAbove >= spaceBelow;
    const available = wantsAbove ? spaceAbove : spaceBelow;
    const maxHeight = Math.max(160, Math.min(PANEL_MAX_HEIGHT, available));
    setLayout({
      left,
      width,
      maxHeight,
      placement: wantsAbove ? "top" : "bottom",
      ...(wantsAbove
        ? { bottom: vh - rect.top + PANEL_GAP }
        : { top: rect.bottom + PANEL_GAP }),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
  }, [open, measure]);

  // 打开时复位搜索/active；关闭不清空 query，退出动画保留当前过滤结果
  useEffect(() => {
    if (!open) return;
    setQuery("");
    activeScrollRef.current = "keyboard";
    setActiveIndex(selectedIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 过滤结果变化：无查询时贴回选中项；有查询时从第一个匹配项开始
  useEffect(() => {
    if (!open) return;
    activeScrollRef.current = "keyboard";
    setActiveIndex(q ? 0 : selectedIndex);
  }, [open, q, selectedIndex]);

  useRestoreFocus(open);

  useEffect(() => {
    if (!open || !layout) return;
    const raf = window.requestAnimationFrame(() => {
      searchRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [open, layout]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, setOpen]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, setOpen]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, measure]);

  // active 行滚入列表可视区：仅键盘导航触发。鼠标 hover 只换高亮，不滚列表，
  // 否则 hover 下方半可见选项时 scrollTop 会瞬间跳一截（硬切感）。
  useEffect(() => {
    if (!open || activeScrollRef.current !== "keyboard") return;
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-model-index="${activeIndex}"]`);
    if (!list || !el) return;
    const listRect = list.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    if (elRect.top < listRect.top) list.scrollTop -= listRect.top - elRect.top;
    else if (elRect.bottom > listRect.bottom) list.scrollTop += elRect.bottom - listRect.bottom;
  }, [activeIndex, open]);

  const choose = useCallback(
    (value: string) => {
      onSelectModel(value);
      setOpen(false);
    },
    [onSelectModel, setOpen]
  );

  const moveActive = useCallback(
    (delta: 1 | -1) => {
      if (visibleModels.length === 0) return;
      setActiveIndex((index) => (index + delta + visibleModels.length) % visibleModels.length);
    },
    [visibleModels.length]
  );

  const onSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveActive(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveActive(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(Math.max(0, visibleModels.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const model = visibleModels[activeIndex];
      if (model) choose(model.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  const panel =
    typeof document !== "undefined"
      ? createPortal(
          <AnimatePresence>
            {open && layout && (
              <motion.div
                key="kiro-model-panel"
                ref={panelRef}
                id={panelId}
                role="menu"
                aria-label="选择模型"
                data-testid="kiro-composer-model-menu"
                data-kiro-composer-menu="model"
                data-appearance={appearance}
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                className="kiro-model-glass fixed z-[110] flex flex-col overflow-hidden rounded-2xl"
                style={{
                  left: layout.left,
                  top: layout.top,
                  bottom: layout.bottom,
                  width: layout.width,
                  maxHeight: layout.maxHeight,
                  transformOrigin: layout.placement === "top" ? "bottom right" : "top right",
                }}
                initial={
                  reducedMotion
                    ? false
                    : {
                        opacity: 0,
                        scale: 0.97,
                        y: -8,
                        backdropFilter: "blur(0px) saturate(1)",
                        WebkitBackdropFilter: "blur(0px) saturate(1)",
                      }
                }
                animate={{
                  opacity: 1,
                  scale: 1,
                  y: 0,
                  backdropFilter: "blur(18px) saturate(1.2)",
                  WebkitBackdropFilter: "blur(18px) saturate(1.2)",
                }}
                exit={
                  reducedMotion
                    ? { opacity: 0, transition: { duration: 0 } }
                    : {
                        opacity: 0,
                        scale: 0.98,
                        y: -6,
                        transition: { duration: PANEL_EXIT_S, ease: EASE_BEZIER.exit },
                      }
                }
                transition={
                  reducedMotion
                    ? { duration: 0 }
                    : { duration: PANEL_ENTER_S, ease: EASE_BEZIER.standard }
                }
              >
                <div className="flex min-h-0 flex-1 flex-col py-1.5">
                  <p className="px-4 pt-2 pb-1.5 text-[10px] font-bold text-sandrift">模型</p>
                  {modelUnavailable && (
                    <p className="px-4 py-2 text-[11px] font-semibold text-danger">
                      当前模型已不可用，请重新选择。
                    </p>
                  )}
                  {modelOptions.length === 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onOpenSettings();
                      }}
                      className="w-full text-left px-4 py-2.5 text-xs text-sandrift hover:text-charcoal transition-colors"
                    >
                      请先在设置中填写模型 ID。
                    </button>
                  ) : (
                    <>
                      <div className="px-3 pb-2">
                        <div
                          className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-line-soft focus-within:border-line-strong transition-colors"
                          style={{ background: "var(--kiro-glass-field)" }}
                        >
                          <Search className="w-3.5 h-3.5 text-sandrift shrink-0" aria-hidden="true" />
                          <input
                            ref={searchRef}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={onSearchKeyDown}
                            placeholder="搜索模型..."
                            aria-label="搜索模型"
                            className="flex-1 min-w-0 bg-transparent text-xs text-charcoal placeholder:text-sandrift/70 focus:outline-none"
                          />
                          {query && (
                            <button
                              type="button"
                              onClick={() => setQuery("")}
                              aria-label="清空搜索"
                              className="p-0.5 rounded text-sandrift hover:text-charcoal transition-colors shrink-0"
                            >
                              <X className="w-3 h-3" aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      </div>
                      <div
                        ref={listRef}
                        id={listId}
                        role="group"
                        aria-label="模型列表"
                        data-testid="kiro-model-list"
                        className="min-h-0 flex-1 overflow-y-auto overflow-x-clip overscroll-contain scrollbar-none px-2 pb-1"
                      >
                        {visibleModels.length === 0 && (
                          <p className="px-3 py-2.5 text-xs text-sandrift">无匹配模型</p>
                        )}
                        {visibleModels.map((m, index) => {
                          const isSelected = m.value === selectedModelId;
                          const isActive = index === activeIndex;
                          return (
                            <button
                              key={m.value}
                              type="button"
                              id={optionId(index)}
                              role="menuitemradio"
                              aria-checked={isSelected}
                              data-model-index={index}
                              onMouseEnter={() => {
                                activeScrollRef.current = "pointer";
                                setActiveIndex(index);
                              }}
                              onFocus={() => {
                                activeScrollRef.current = "keyboard";
                                setActiveIndex(index);
                              }}
                              onClick={() => choose(m.value)}
                              className={cn(
                                "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-xs font-semibold transition-colors",
                                isSelected
                                  ? "text-charcoal bg-pastel-mint"
                                  : isActive
                                    ? "text-charcoal bg-alabaster"
                                    : "text-satin-grey hover:bg-alabaster"
                              )}
                            >
                              <ProviderLogo vendor={m.vendor} size="md" />
                              <span className="min-w-0 flex-1 truncate">{m.label}</span>
                              {isSelected && (
                                <Check className="w-4 h-4 text-charcoal shrink-0" aria-hidden="true" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )
      : null;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (disabled) return;
          setOpen(!open);
        }}
        aria-label="选择模型"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? panelId : undefined}
        disabled={disabled}
        data-testid="kiro-composer-model"
        data-model-open={open}
        className={cn(
          "flex items-center h-9 rounded-xl transition-[background-color,border-color,color,transform] duration-[var(--motion-fast)] disabled:opacity-40 disabled:cursor-not-allowed min-w-0",
          "active:scale-[0.99]",
          compact
            ? cn(
                "w-9 justify-center",
                open ? "bg-alabaster text-charcoal" : "text-sandrift hover:bg-alabaster hover:text-charcoal"
              )
            : cn(
                "gap-1.5 px-2.5 text-[11px] font-semibold",
                open
                  ? "bg-alabaster text-charcoal border border-line-strong"
                  : "text-sandrift border border-transparent hover:bg-alabaster hover:text-charcoal"
              )
        )}
      >
        <ProviderLogo vendor={activeModelVendor} size="sm" />
        {!compact && (
          <>
            <span className="truncate max-w-[150px]">{activeModelName}</span>
            <ChevronDown
              className={cn(
                "w-3 h-3 shrink-0 transition-transform duration-[var(--kiro-motion-control,var(--motion-fast))] ease-[var(--ease-standard)]",
                open && "rotate-180"
              )}
            />
          </>
        )}
      </button>
      {panel}
    </div>
  );
}
