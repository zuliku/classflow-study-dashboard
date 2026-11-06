"use client";

import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { usePresence } from "@/lib/usePresence";
import { useInertOnHidden } from "@/lib/useInertOnHidden";
import { pushOverlay, popOverlay, isTopmostOverlay, getTopOverlayZ } from "@/lib/overlayStack";
import { MOTION_EXIT_MS } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * ClassFlow 通用 Select（Settings V3 Task 6）：
 * 自定义 trigger + anchored dropdown（portal 到 body，避免被 Settings overflow 容器裁切）。
 * - ARIA：trigger role=combobox / aria-haspopup=listbox / aria-expanded / aria-activedescendant；
 *   menu role=listbox；item role=option / aria-selected
 * - 键盘：Enter/Space 打开；↑↓ 导航；Home/End；Enter 选择；Escape 关闭并聚焦回 trigger；Tab 关闭
 * - 鼠标：click 打开/选择；outside click 关闭；scroll/resize 关闭
 * - 层级：open 时进入 overlay 栈（z 跟随宿主 Dialog/Drawer），Esc 只由 topmost 消费者处理；
 *   退出期 inert，避免 Tab 进入正在淡出的选项。
 * - 结构：外壳 overflow-hidden；searchable 时搜索栏固定在滚动区外，只有下方选项列表滚动，
 *   避免 sticky 搜索栏与滚动内容同容器时文字从搜索栏上方缝隙透出（模型/课程等长列表通用）
 * - 动画（Motion Contract）：open = opacity + translateY(2px→0)；enter = --motion-fast，
 *   exit = --motion-exit-fast，unmount = MOTION_EXIT_MS.fast（共享 usePresence，同源对应）
 * - focus：mouse 点击不保留刺眼 ring；键盘 focus-visible 轻量 ring（:focus-visible）
 */

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
}

interface UISelectProps<T extends string | number> {
  value: T;
  onChange: (v: T) => void;
  options: SelectOption<T>[];
  ariaLabel?: string;
  disabled?: boolean;
  /** value 未匹配任何 option 时显示（如批量操作占位） */
  placeholder?: string;
  /** trigger 样式（SettingsSelect 传入 Settings 规格） */
  triggerClassName?: string;
  /** 菜单容器附加样式 */
  menuClassName?: string;
  /** 菜单项高度（默认 h-9） */
  itemClassName?: string;
  testid?: string;
  /**
   * Codex-style 小搜索：打开时顶部出现过滤输入（长列表如课程/模型/关联对象）。
   * 默认关闭——短列表行为零变化；过滤后键盘导航/Enter 选择均走过滤结果。
   */
  searchable?: boolean;
  /** 搜索框占位（默认“搜索选项...”） */
  searchPlaceholder?: string;
}

export function UISelect<T extends string | number>({
  value,
  onChange,
  options,
  ariaLabel,
  disabled,
  triggerClassName,
  menuClassName,
  itemClassName,
  placeholder,
  testid,
  searchable,
  searchPlaceholder,
}: UISelectProps<T>) {
  const baseId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const listboxId = `select-listbox-${baseId}`;
  const overlayId = `select-overlay-${baseId}`;
  // semantic state：open 拥有交互所有权；mounted/visible 仅表达 presentation（共享 presence lifecycle）
  const [open, setOpen] = useState(false);
  const { mounted, visible } = usePresence(open, MOTION_EXIT_MS.fast);
  /** 退出窗口内 inert：正在淡出的选项不可 Tab/二次点击（进入期不阻断焦点） */
  const inertRef = useInertOnHidden<HTMLDivElement>(!open);
  /**
   * 选择完成后的立即卸载旁路：跳过退出窗口，不拦截紧随其后的 Escape / 父 Overlay 交互。
   * （既有语义：selection 不做 animated close——普通 outside/Escape/Tab 关闭才走 exit 动画。）
   */
  const [suppressRender, setSuppressRender] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(0, options.findIndex((o) => o.value === value))
  );
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  /** 打开时 trigger 宽度（dropdown min-width 基准；dropdown 本身可更宽） */
  const [triggerWidth, setTriggerWidth] = useState<number | undefined>(undefined);
  /** 水平定位：先 left-align，溢出 viewport 时右对齐修正（挂载后测量） */
  const [menuLeft, setMenuLeft] = useState<number | undefined>(undefined);
  const [viewportMaxWidth, setViewportMaxWidth] = useState<number>(320);
  /** 菜单 z：跟随当前宿主 overlay（Dialog/Drawer 内同层后挂载，Confirm/Toast 仍在更上层） */
  const [menuZ, setMenuZ] = useState(40);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const setMenuNode = useCallback(
    (node: HTMLDivElement | null) => {
      menuRef.current = node;
      inertRef(node);
    },
    [inertRef]
  );
  const searchRef = useRef<HTMLInputElement | null>(null);
  /** 只有键盘导航才自动滚动/移焦；鼠标 hover 只换高亮，避免下方选项 hover 时硬跳 */
  const activeScrollRef = useRef<"keyboard" | "pointer">("keyboard");
  // Codex-style 过滤：非 searchable 时 filtered 与 options 同一引用，全部逻辑零分支
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!searchable || !q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query, searchable]);
  const selectedIndex = Math.max(0, filtered.findIndex((o) => o.value === value));

  // 打开：presence 负责 mount hidden → 双 rAF 后 visible（进入过渡）；此处只做定位测量 + semantic open
  const openMenu = useCallback(() => {
    if (disabled || options.length === 0) return;
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const itemH = 36; // h-9
    // searchable 的搜索栏本身约 42px；不计入会算出「1 个选项 → 44px」，
    // 搜索栏吃掉全部高度，选项列表只剩 2px。上限同步放宽，避免长列表被挤。
    const searchH = searchable ? 42 : 0;
    const estHeight = Math.min(options.length * itemH + 8 + searchH, 280 + searchH);
    const gap = 6;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUp = spaceBelow < estHeight + gap && spaceAbove > spaceBelow;
    const top = openUp ? rect.top - estHeight - gap : rect.bottom + gap;
    // 宽度策略：dropdown 与 trigger 解耦——min-width = trigger 宽，内容自动撑开，viewport 上限
    setMenuStyle({
      position: "fixed",
      top: Math.max(8, top),
      maxHeight: openUp ? Math.min(estHeight, spaceAbove - 16) : Math.min(estHeight, spaceBelow - 16),
    });
    setTriggerWidth(rect.width);
    setMenuLeft(rect.left);
    setViewportMaxWidth(Math.min(320, window.innerWidth - 16));
    setMenuZ(Math.max(40, getTopOverlayZ()));
    setSuppressRender(false);
    setQuery("");
    activeScrollRef.current = "keyboard";
    setOpen(true);
    setActiveIndex(options.findIndex((o) => o.value === value));
  }, [disabled, options, value, searchable]);

  // 关闭：semantic close → usePresence 播放退出（exit-fast）后卸载；reduced motion 即时落位
  const closeMenu = useCallback(() => {
    setOpen(false);
  }, []);

  /** Esc / 选择后归还焦点：立即 + 下一帧各一次，避免退出期间卸载焦点元素导致焦点落回 body */
  const restoreTriggerFocus = useCallback(() => {
    triggerRef.current?.focus();
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, []);

  // Overlay 栈：Select 是真正的顶层消费者（此前仅靠 z=100 + capture Esc 越权）。
  // 打开时按宿主层级入栈；语义关闭立即出栈，退出动画不占用下一层 Esc。
  useEffect(() => {
    if (!open) return;
    pushOverlay(overlayId, menuZ);
    return () => popOverlay(overlayId);
  }, [open, overlayId, menuZ]);

  // outside click / scroll / resize 关闭
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      closeMenu();
    };
    // 菜单内部滚动（overflow-y-auto listbox）不应关闭菜单；外部页面/容器滚动保持关闭，
    // 避免 fixed-position 菜单与 Trigger 脱锚（capture 阶段监听，事件 target 判定来源）
    const onScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      closeMenu();
    };
    const onResize = () => closeMenu();
    document.addEventListener("pointerdown", onPointerDown);
    // passive：只做关闭判定从不 preventDefault，不得阻塞滚动
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, closeMenu]);

  // Escape 全局（菜单打开且可见时拦截；淡出中不拦截，避免吞掉 Modal / Drawer 的 Escape）
  const visibleRef = useRef(visible);
  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // 只有 topmost 才消费 Esc：后台 Select 不再抢 Confirm/Dialog 的关闭
      if (e.key === "Escape" && visibleRef.current && isTopmostOverlay(overlayId)) {
        // 注册在 window capture，先于上层 Overlay 的 window bubble listener 取得 Esc 所有权。
        e.stopPropagation();
        e.preventDefault();
        closeMenu();
        restoreTriggerFocus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, overlayId, closeMenu, restoreTriggerFocus]);

  // 打开时聚焦：searchable → 搜索框；否则当前选中项。
  // 只在 open/mounted 变化时执行一次，不跟随 hover 的 activeIndex（避免焦点被抢）。
  // useLayoutEffect：在 listbox 可见前完成聚焦，避免「Open 后立刻按方向键」被 trigger 吞掉。
  useLayoutEffect(() => {
    if (!open || !visible) return;
    if (searchable) {
      searchRef.current?.focus({ preventScroll: true });
      return;
    }
    const el = menuRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, visible, searchable]);

  // active 行滚动/聚焦：仅键盘导航。鼠标 hover 不滚动列表，避免下方选项硬跳。
  useEffect(() => {
    if (!open || !visible || activeScrollRef.current !== "keyboard") return;
    const el = menuRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    if (!el) return;
    if (!searchable) el.focus({ preventScroll: true });
    const scroller = menuRef.current?.querySelector<HTMLElement>('[data-testid="ui-select-options"]');
    if (!scroller) return;
    const listRect = scroller.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    if (elRect.top < listRect.top) scroller.scrollTop -= listRect.top - elRect.top;
    else if (elRect.bottom > listRect.bottom) scroller.scrollTop += elRect.bottom - listRect.bottom;
  }, [activeIndex, open, visible, searchable]);

  // 挂载后测量实际宽度：右侧溢出 → 右对齐修正；至少保留 8px viewport inset
  useEffect(() => {
    if (!open || !visible) return;
    const menu = menuRef.current;
    if (!menu || menuLeft === undefined) return;
    const vw = window.innerWidth;
    const width = menu.offsetWidth;
    let left = menuLeft;
    if (left + width > vw - 8) left = vw - 8 - width;
    if (left < 8) left = 8;
    if (left !== menuLeft) setMenuLeft(left);
  }, [open, visible, menuLeft]);

  // 搜索内容变化：active 回到首项（由列表滚动跟随，不抢搜索框焦点）
  useEffect(() => {
    if (!open || !query) return;
    activeScrollRef.current = "keyboard";
    setActiveIndex(0);
  }, [open, query]);

  // 过滤收缩时 active 越界 → 回到首项（空结果时保持 0，不触发选择）
  useEffect(() => {
    if (activeIndex >= filtered.length) {
      activeScrollRef.current = "keyboard";
      setActiveIndex(0);
    }
  }, [filtered.length, activeIndex]);

  const selectOption = (index: number) => {
    const opt = filtered[index];
    if (!opt) return;
    onChange(opt.value);
    // 选择完成：立即卸载（不经退出窗口，避免拦截紧随其后的 Escape / 上层交互）——保留既有语义
    setSuppressRender(true);
    setOpen(false);
    restoreTriggerFocus();
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openMenu();
    }
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    // 搜索框内空格是输入字符，不是选择（Enter 仍确认选择）
    const inSearch = (e.target as HTMLElement | null)?.tagName === "INPUT";
    if (e.key === "Escape") {
      // 只有 topmost 才消费 Esc（上层 Confirm/Dialog 优先）
      if (!isTopmostOverlay(overlayId)) return;
      // Portal 内由 React handler 同步消费，避免原生 window overlay listener 关闭父 Dialog。
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
      restoreTriggerFocus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      activeScrollRef.current = "keyboard";
      setActiveIndex((i) => (filtered.length === 0 ? 0 : (i + 1) % filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeScrollRef.current = "keyboard";
      setActiveIndex((i) => (filtered.length === 0 ? 0 : (i - 1 + filtered.length) % filtered.length));
    } else if (e.key === "Home") {
      e.preventDefault();
      activeScrollRef.current = "keyboard";
      setActiveIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      activeScrollRef.current = "keyboard";
      setActiveIndex(Math.max(0, filtered.length - 1));
    } else if (e.key === "Enter" || (e.key === " " && !inSearch)) {
      e.preventDefault();
      selectOption(activeIndex);
    } else if (e.key === "Tab") {
      closeMenu();
    }
  };

  const selectedLabel = options.find((o) => o.value === value)?.label ?? placeholder ?? "";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={ariaLabel}
        aria-activedescendant={open ? `${listboxId}-option-${activeIndex}` : undefined}
        disabled={disabled}
        data-testid={testid}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          "flex items-center justify-between gap-2 px-2.5 h-9 rounded-lg bg-background border border-line text-xs font-bold text-charcoal cursor-pointer",
          "focus:outline-none focus:border-charcoal focus-visible:outline-2 focus-visible:outline-charcoal/30",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          "transition-colors duration-[var(--motion-fast)]",
          triggerClassName
        )}
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown
          className={cn(
            "w-3.5 h-3.5 text-sandrift shrink-0 transition-transform duration-[var(--motion-fast)]",
            open && "rotate-180"
          )}
          aria-hidden="true"
        />
      </button>

      {/* presentation：mounted 决定 Portal 是否存在（exit 期间延迟卸载）；visible 决定 opacity/transform */}
      {mounted && !suppressRender &&
        createPortal(
          <div
            ref={setMenuNode}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            style={{
              ...menuStyle,
              left: menuLeft,
              // 宽度与 trigger 解耦：min = trigger 宽（或 168px 下限），内容自动撑开，viewport 上限
              minWidth: Math.max(triggerWidth ?? 0, 168),
              maxWidth: viewportMaxWidth,
              zIndex: menuZ,
            }}
            className={cn(
              // 固定外壳：搜索栏在滚动区外，选项只在其下方的列表内滚动。
              // 若搜索栏与选项同处一个滚动容器（sticky + padding），滚动时选项文字会从
              // 搜索栏上方的 padding/边框缝隙透出，形成「搜索框上出现文字」的穿帮。
              "flex flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-card pointer-events-auto",
              // opacity + transform 同一 transition-property（此前 transition-opacity + transition-transform
              // 两条声明打架，只有一个生效，opacity 无过渡直接闪现）
              "transition-[opacity,transform] ease-[var(--ease-standard)]",
              // enter = --motion-fast；exit = --motion-exit-fast（更快）+ 加速离场，与 presence unmount 同源对应
              visible
                ? "opacity-100 translate-y-0 duration-[var(--motion-fast)]"
                : "opacity-0 translate-y-0.5 pointer-events-none !duration-[var(--motion-exit-fast)] !ease-[var(--ease-exit)]",
              menuClassName
            )}
            onKeyDown={onMenuKeyDown}
          >
            {searchable && (
              <div className="shrink-0 px-1.5 pt-1.5 pb-1 bg-surface" data-testid="ui-select-search">
                <div className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-line-soft bg-background focus-within:border-line-strong transition-colors">
                  <Search className="w-3.5 h-3.5 text-sandrift shrink-0" aria-hidden="true" />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={searchPlaceholder ?? "搜索选项..."}
                    aria-label={ariaLabel ? `搜索${ariaLabel}` : "搜索选项"}
                    className="flex-1 min-w-0 bg-transparent text-xs text-charcoal placeholder:text-sandrift/70 focus:outline-none"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      aria-label="清空搜索"
                      tabIndex={-1}
                      className="p-0.5 rounded text-sandrift hover:text-charcoal transition-colors shrink-0"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            )}
            <div
              className="min-h-0 flex-1 overflow-y-auto overflow-x-clip scrollbar-none py-1"
              data-testid="ui-select-options"
            >
              {filtered.length === 0 && (
                <div role="status" className="px-3 py-2.5 text-xs text-sandrift">
                  无匹配选项
                </div>
              )}
              {filtered.map((opt, i) => {
                const isSelected = opt.value === value;
                const isActive = i === activeIndex;
                return (
                  <button
                    key={String(opt.value)}
                    type="button"
                    id={`${listboxId}-option-${i}`}
                    role="option"
                    aria-selected={isSelected}
                    data-index={i}
                    tabIndex={-1}
                    onClick={() => selectOption(i)}
                    onMouseEnter={() => {
                      activeScrollRef.current = "pointer";
                      setActiveIndex(i);
                    }}
                    className={cn(
                      "flex w-full items-center gap-1.5 px-2.5 text-xs font-semibold text-left",
                      "focus:outline-none active:opacity-70 transition-opacity duration-[var(--motion-fast)]",
                      itemClassName ?? "h-9",
                      isSelected
                        ? "bg-pastel-mint/50 text-charcoal font-bold"
                        : isActive
                          ? "bg-alabaster text-charcoal"
                          : "text-satin-grey hover:bg-alabaster hover:text-charcoal"
                    )}
                  >
                    <span className="w-4 shrink-0 flex items-center justify-center">
                      {isSelected && <Check className="w-3.5 h-3.5 text-charcoal" aria-hidden="true" />}
                    </span>
                    {/* 常规 label 单行完整显示；仅超过菜单 max-width 时才省略 */}
                    <span className="whitespace-nowrap overflow-hidden text-ellipsis">
                      {opt.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
