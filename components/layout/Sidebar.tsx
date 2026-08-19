"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useUIChromeStore } from "@/store/useUIChromeStore";
import { useReminderCenterStore } from "@/store/useReminderCenterStore";
import { hasUnreadFiredReminders } from "@/lib/reminders/reminderCenterView";
import { useEffectiveReducedMotion } from "@/hooks/useEffectiveReducedMotion";
import { cn } from "@/lib/utils";
import {
  MAIN_NAV_ITEMS,
  AI_NAV_ITEMS,
  GLOBAL_NAV_ACTIONS,
} from "@/components/layout/navItems";
import { SidebarProfileCard } from "@/components/layout/SidebarProfileCard";

/** 桌面展开断点（≥1280）：用户可手动折叠；<1280 强制 icon rail。resolved 标记视口已测量（hydration guard）。 */
function useIsXl(): { isXl: boolean; resolved: boolean } {
  // Desktop Renderer 无 SSR hydration：首帧直接同步 matchMedia，避免 64px → 224px 额外 App Layout
  const [isXl, setIsXl] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia("(min-width: 1280px)").matches
  );
  const [resolved, setResolved] = useState(() => isXl);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)");
    const apply = () => setIsXl(mq.matches);
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return { isXl, resolved };
}

/** Plate 测量去重：y/h 未真实变化时返回 false（避免无意义 setState → React commit） */
export function shouldUpdatePlate(
  prev: { y: number; h: number } | null,
  next: { y: number; h: number }
): boolean {
  return prev === null || prev.y !== next.y || prev.h !== next.h;
}

/**
 * Sidebar（App Chrome V2.1）：
 * - <768：隐藏（Bottom Nav）；768–1279：强制 icon rail；≥1280：用户可折叠（persisted）
 * - Rail Morph：仅用户手动点击播放完整动画（motionActive + direction），
 *   hydration / 断点 / reduced-motion 一律瞬时切换（无启动动画、无跨断点 morph）
 * - Nav 行：固定 Icon Slot（图标 X 稳定）+ Label 始终 mounted（opacity/translate/max-width 裁剪，绝不 display:none）
 * - Logo：Full Logo 与 Mark 同容器 crossfade；Profile：single-DOM morph（SidebarProfileCard）
 */
export function Sidebar() {
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setSettingsModalOpen = useAppStore((s) => s.setSettingsModalOpen);
  // UI Chrome：低成本独立 store（不触发主业务 store persist / 大范围 render）
  const sidebarCollapsed = useUIChromeStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useUIChromeStore((s) => s.setSidebarCollapsed);
  const reminderCenterOpen = useReminderCenterStore((s) => s.isOpen);
  const reminderCenterToggle = useReminderCenterStore((s) => s.toggle);
  const reminders = useAppStore((s) => s.reminders);
  const hasUnread = hasUnreadFiredReminders(reminders);
  const reducedMotion = useEffectiveReducedMotion();
  const { isXl, resolved } = useIsXl();

  // <1280 强制 icon rail；≥1280 遵循用户持久化状态
  const effectiveCollapsed = isXl ? sidebarCollapsed : true;

  // ---- Rail Morph Motion State（transient UI，不入 store）----
  // 只有用户主动点击才进入 manual morph；transitionend(width) 后回落 idle。
  const [motionActive, setMotionActive] = useState(false);
  const [motionDirection, setMotionDirection] = useState<"collapse" | "expand" | null>(null);
  // ref 供 ResizeObserver 回调读取（回调闭包捕获旧 state 会失效）
  const motionActiveRef = useRef(false);

  const toggleCollapsed = () => {
    const next = !sidebarCollapsed;
    if (!reducedMotion) {
      motionActiveRef.current = true;
      setMotionActive(true);
      setMotionDirection(next ? "collapse" : "expand");
    }
    setSidebarCollapsed(next);
  };

  const handleShellTransitionEnd = (e: React.TransitionEvent<HTMLElement>) => {
    // 只认 Sidebar width 段：动画完成 → 回落 idle（CSS transition 可直接从当前位置反向，无 timer queue）
    if (e.propertyName !== "width") return;
    motionActiveRef.current = false;
    setMotionActive(false);
    setMotionDirection(null);
    // motion 结束后做一次最终 plate 校正（motionActive 期间冻结了 RO measure）
    requestAnimationFrame(() => measurePlate());
  };

  // ---- 共享 Navigation Active Plate（IM1）：MAIN_NAV 唯一 selection surface ----
  // 仅 transform/opacity 动画（无 top/margin/layout reflow）；首次加载直接定位不播放动画。
  const navRef = useRef<HTMLElement | null>(null);
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const interactedRef = useRef(false);
  const [plate, setPlate] = useState<{ y: number; h: number } | null>(null);

  const measurePlate = useCallback(() => {
    const el = itemRefs.current.get(activeTab);
    if (!el) return;
    const next = { y: el.offsetTop, h: el.offsetHeight };
    // 相同 y/h 不创建新 state object（避免无意义 React commit）
    setPlate((prev) => (shouldUpdatePlate(prev, next) ? next : prev));
  }, [activeTab]);

  // 首次 render / activeTab 变化：paint 前同步定位（无 transition 由 interacted 控制）
  useLayoutEffect(() => {
    measurePlate();
  }, [measurePlate]);

  // nav 垂直尺寸变化 → 重新测量。
  // 只响应 block-size（contentRect.height）真实变化；宽度 morph 不触发（nav 行高折叠时不变）。
  // motionActive（manual morph）期间冻结：transitionend 后再做一次最终校正。
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    let lastHeight = -1;
    const ro = new ResizeObserver((entries) => {
      if (motionActiveRef.current) return;
      const entry = entries[0];
      if (!entry) return;
      const h = entry.contentRect.height;
      if (h === lastHeight) return;
      lastHeight = h;
      measurePlate();
    });
    ro.observe(nav);
    return () => ro.disconnect();
  }, [measurePlate]);

  const isMainActive = MAIN_NAV_ITEMS.some((i) => i.id === activeTab);
  // 用户交互后才启用 transform transition；reduced motion 始终直接定位
  const plateAnimated = interactedRef.current && !reducedMotion;

  // Navigation Area 滚动：仅在内容真实溢出（低高度 viewport）时启用 overflow-y-auto；
  // 常态 overflow-visible → rail tooltip（left-full）不被裁剪（V2 baseline 语义）。
  const navAreaRef = useRef<HTMLDivElement | null>(null);
  const [navScrollable, setNavScrollable] = useState(false);
  useLayoutEffect(() => {
    const el = navAreaRef.current;
    if (!el) return;
    let lastHeight: number | null = null;
    let lastScrollable: boolean | null = null;
    const check = () => {
      // 只响应 block-size 变化（宽度 morph 不影响 overflow-y）
      if (el.clientHeight === lastHeight) return;
      lastHeight = el.clientHeight;
      const next = el.scrollHeight > el.clientHeight + 1;
      if (next !== lastScrollable) {
        lastScrollable = next;
        setNavScrollable(next);
      }
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Nav 行共用工具提示（始终 mounted；manual morph 期间 CSS 强制隐藏） */
  const tooltip = (label: string) => (
    <span
      data-testid="nav-tooltip"
      role="tooltip"
      className={cn(
        "sidebar-tooltip absolute left-full top-1/2 -translate-y-1/2 ml-2",
        "px-2 py-1 rounded-lg bg-charcoal text-white text-[11px] whitespace-nowrap",
        "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
        "transition-opacity duration-[var(--motion-fast)] pointer-events-none z-50"
      )}
    >
      {label}
    </span>
  );

  return (
    <aside
      className={cn(
        "sidebar-shell hidden md:flex h-[calc(100vh-var(--titlebar-h))] bg-[#F7F5F5] border-r border-line flex-col pt-3.5 px-3.5 pb-3.5 sticky top-0 select-none z-20 shrink-0",
        effectiveCollapsed ? "w-16" : "w-56"
      )}
      data-testid="app-sidebar"
      data-collapsed={effectiveCollapsed}
      data-motion-active={motionActive}
      data-motion-direction={motionDirection}
      data-viewport-resolved={resolved}
      onTransitionEnd={handleShellTransitionEnd}
    >
      {/* Navigation Area：flex-1 / min-h-0；仅溢出时滚动（常态不裁剪 rail tooltip） */}
      <div
        ref={navAreaRef}
        className={cn(
          "flex-1 min-h-0 space-y-3 scrollbar-none",
          navScrollable ? "overflow-y-auto" : "overflow-visible"
        )}
      >
        {/* Brand Logo：Full Logo ↔ Mark 同容器 crossfade（始终 mounted；绝对定位互不挤压） */}
        <div
          className="sidebar-logo relative h-10 w-full overflow-hidden cursor-pointer"
          onClick={() => {
            interactedRef.current = true;
            setActiveTab("overview");
          }}
        >
          <img
            src="/logo.png"
            alt="ClassFlow"
            aria-hidden={effectiveCollapsed ? "true" : undefined}
            className="sidebar-logo-full absolute left-1/2 top-1/2 w-auto max-h-8 object-contain mix-blend-multiply"
          />
          <img
            src="/branding/classflow-mark.png"
            alt="ClassFlow"
            aria-hidden={effectiveCollapsed ? undefined : "true"}
            className="sidebar-logo-mark absolute left-1/2 top-1/2 w-8 h-8 object-contain"
          />
        </div>

        {/* Navigation Menu（核心学习功能） */}
        <nav ref={navRef} className="relative space-y-0.5">
          {/* 共享 Navigation Active Plate：MAIN_NAV 唯一 selection surface（surface + 左侧指示条一体移动）。
              transform/opacity 动画；用户交互后才启用 transition；首次加载直接定位；reduced 直接跳转；
              Kiro（非 MAIN_NAV）时淡出。 */}
          <div
            aria-hidden="true"
            data-testid="nav-active-plate"
            className={cn(
              "absolute left-0 right-0 rounded-xl bg-pastel-mint shadow-subtle transition-[transform,opacity] ease-[var(--ease-standard)]",
              plateAnimated ? "duration-[var(--motion-base)]" : "duration-0",
              isMainActive ? "opacity-100" : "opacity-0"
            )}
            style={{
              transform: plate ? `translateY(${plate.y}px)` : "translateY(-40px)",
              height: plate?.h ?? 40,
            }}
          >
            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-full bg-charcoal" />
          </div>

          {MAIN_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                ref={(el) => {
                  if (el) itemRefs.current.set(item.id, el);
                  else itemRefs.current.delete(item.id);
                }}
                onClick={() => {
                  interactedRef.current = true;
                  setActiveTab(item.id);
                }}
                aria-label={item.label}
                aria-current={isActive ? "page" : undefined}
                className={cn("sidebar-nav-row relative w-full py-2 rounded-xl text-xs font-medium transition-colors duration-[var(--motion-base)] ease-[var(--ease-standard)] group text-left",
                  isActive
                    ? "text-charcoal font-semibold"
                    : "text-satin-grey hover:bg-alabaster hover:text-charcoal"
                )}
              >
                <Icon
                  className={cn(
                    "w-4 h-4 shrink-0 transition-colors duration-[var(--motion-base)]",
                    isActive ? "text-charcoal" : "text-sandrift group-hover:text-charcoal"
                  )}
                />
                {/* Label：始终 mounted；折叠 = opacity/max-width 裁剪（Rail Morph） */}
                <span data-testid="nav-label" className="sidebar-label flex-1 min-w-0 text-left">
                  {item.label}
                </span>
                {tooltip(item.label)}
              </button>
            );
          })}
        </nav>

        {/* AI Agent 区域：Kiro Featured Entry（独立分组，不做普通 nav row） */}
        <div className="mt-3 pt-3 border-t border-line-soft space-y-0.5">
          {AI_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                aria-label={item.label}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "relative w-full flex items-center rounded-xl group text-left",
                  "overflow-hidden transition-colors duration-[var(--motion-base)] ease-[var(--ease-standard)]"
                )}
              >
                {/* 1px 品牌流光：常驻（Idle 0.8 → Hover/Active 1）；DOM 始终 mounted，折叠不触发 ring restart */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute -inset-1/2 kiro-ring kiro-featured-flow pointer-events-none",
                    "opacity-80 transition-opacity duration-[var(--motion-fast)]",
                    "group-hover:opacity-100 group-focus-visible:opacity-100",
                    isActive && "opacity-100!"
                  )}
                />
                {/* 内容层：m-[1.5px] + w calc(100%-3px)，四边均匀留出 1.5px 流光环（细 1 倍，基底高亮无断口） */}
                <span
                  className={cn(
                    "relative m-[1.5px] w-[calc(100%-3px)] h-11 rounded-[11px] bg-[#F7F5F5]",
                    "sidebar-nav-row sidebar-nav-row-kiro text-xs font-semibold transition-colors duration-[var(--motion-base)]",
                    isActive ? "bg-surface text-charcoal" : "text-charcoal"
                  )}
                >
                  <Icon className="w-5 h-5 shrink-0" />
                  <span data-testid="nav-label" className="sidebar-label flex-1 min-w-0 truncate">
                    {item.label}
                  </span>
                  {tooltip(item.label)}
                </span>
              </button>
            );
          })}
        </div>

        {/* 全局 Action：Reminder Center（Bell，unread 圆点锚定 Icon Slot）/ Settings（Modal 入口） */}
        <div className="pt-1 mt-1 border-t border-line-soft space-y-0.5">
          {GLOBAL_NAV_ACTIONS.map((item) => {
            const Icon = item.icon;
            const isReminders = item.id === "reminders";
            return (
              <button
                key={item.id}
                onClick={() =>
                  isReminders ? reminderCenterToggle() : setSettingsModalOpen(true)
                }
                aria-label={item.label}
                aria-expanded={isReminders ? reminderCenterOpen : undefined}
                className={cn("sidebar-nav-row relative w-full py-2 rounded-xl text-xs font-medium transition-colors duration-[var(--motion-base)] ease-[var(--ease-standard)] group text-left",
                  isReminders && reminderCenterOpen
                    ? "bg-alabaster text-charcoal"
                    : "text-satin-grey hover:bg-alabaster hover:text-charcoal"
                )}
              >
                {/* Bell 图标 + unread 圆点（锚定图标，折叠/展开无需重新定位） */}
                <span className="relative flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 shrink-0 transition-colors duration-[var(--motion-base)] text-sandrift group-hover:text-charcoal" />
                  {isReminders && hasUnread && (
                    <span
                      aria-hidden="true"
                      data-testid="reminder-unread-dot"
                      className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-danger border border-surface"
                    />
                  )}
                </span>
                <span data-testid="nav-label" className="sidebar-label flex-1 min-w-0 truncate">
                  {item.label}
                </span>
                {tooltip(item.label)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Profile Region：shrink-0（不随导航滚动；低高度 viewport 由上方导航区收缩） */}
      <div className="shrink-0 pt-1 mt-1 border-t border-line-soft space-y-1.5">
        {/* Collapse / Expand 动作：仅桌面（≥1280）显示；低权重 ghost 图标按钮 */}
        {isXl && (
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
            data-testid="sidebar-collapse-toggle"
            className="w-full flex items-center justify-center py-1 rounded-lg text-sandrift hover:text-charcoal hover:bg-alabaster transition-colors focus-visible:outline-2 focus-visible:outline-charcoal/30"
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="w-4 h-4" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
        )}
        <SidebarProfileCard collapsed={effectiveCollapsed} />
      </div>
    </aside>
  );
}
