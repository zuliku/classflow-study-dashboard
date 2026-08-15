"use client";

import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useReminderCenterStore } from "@/store/useReminderCenterStore";
import { hasUnreadFiredReminders } from "@/lib/reminders/reminderCenterView";
import { useEffectiveReducedMotion } from "@/hooks/useEffectiveReducedMotion";
import { useProfileAvatar } from "@/hooks/useProfileAvatar";
import { cn } from "@/lib/utils";
import {
  MAIN_NAV_ITEMS,
  AI_NAV_ITEMS,
  GLOBAL_NAV_ACTIONS,
} from "@/components/layout/navItems";

export function Sidebar() {
  const { activeTab, setActiveTab, setSettingsModalOpen, userProfile } = useAppStore();
  const reminderCenterOpen = useReminderCenterStore((s) => s.isOpen);
  const reminderCenterToggle = useReminderCenterStore((s) => s.toggle);
  const reminders = useAppStore((s) => s.reminders);
  const hasUnread = hasUnreadFiredReminders(reminders);
  const reducedMotion = useEffectiveReducedMotion();
  const profileAvatarUrl = useProfileAvatar();

  const creditPercentage =
    userProfile.totalCredits > 0
      ? Math.round((userProfile.completedCredits / userProfile.totalCredits) * 100)
      : 0;

  // ---- 共享 Navigation Active Plate（IM1）：MAIN_NAV 唯一 selection surface ----
  // 仅 transform/opacity 动画（无 top/margin/layout reflow）；首次加载直接定位不播放动画。
  const navRef = useRef<HTMLElement | null>(null);
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const interactedRef = useRef(false);
  const [plate, setPlate] = useState<{ y: number; h: number } | null>(null);

  const measurePlate = useCallback(() => {
    const el = itemRefs.current.get(activeTab);
    if (!el) return;
    setPlate({ y: el.offsetTop, h: el.offsetHeight });
  }, [activeTab]);

  // 首次 render / activeTab 变化：paint 前同步定位（无 transition 由 interacted 控制）
  useLayoutEffect(() => {
    measurePlate();
  }, [measurePlate]);

  // nav 尺寸变化（md↔xl breakpoint / 内容变化）→ 重新测量
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const ro = new ResizeObserver(() => measurePlate());
    ro.observe(nav);
    return () => ro.disconnect();
  }, [measurePlate]);

  const isMainActive = MAIN_NAV_ITEMS.some((i) => i.id === activeTab);
  // 用户交互后才启用 transform transition；reduced motion 始终直接定位
  const plateAnimated = interactedRef.current && !reducedMotion;

  return (
    // 三档布局：
    //   <768  隐藏（由 Bottom Nav 承担导航）
    //   768–1279  Icon Rail（w-16，仅图标 + hover/focus tooltip）
    //   ≥1280  完整 Sidebar（w-56，图标 + 文字 + 用户信息）
    <aside className="hidden md:flex w-16 xl:w-56 h-screen bg-[#F7F5F5] border-r border-line flex-col justify-between p-3.5 sticky top-0 select-none z-20 shrink-0">
      {/* Top Section */}
      <div className="space-y-3">
        {/* Brand Logo：Icon Rail 显示图形 Mark；完整 Sidebar 显示全横版 Logo（Responsive Swap，非缩放） */}
        <div
          className="w-full h-10 px-0.5 flex items-center justify-center cursor-pointer"
          onClick={() => {
            interactedRef.current = true;
            setActiveTab("overview");
          }}
        >
          {/* 768–1279 Icon Rail：仅图形 Mark，居中，object-contain */}
          <img
            src="/branding/classflow-mark.png"
            alt="ClassFlow"
            className="hidden md:block xl:hidden w-8 h-8 object-contain"
          />
          {/* ≥1280 完整 Sidebar：图形 + ClassFlow 文字，Sidebar 水平居中，max-width 约束，不拉伸 */}
          <img
            src="/logo.png"
            alt="ClassFlow"
            className="hidden xl:block w-9 h-9 xl:w-auto xl:h-auto xl:max-w-[180px] object-contain mix-blend-multiply"
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
                className={cn(
                  "relative w-full flex items-center justify-center xl:justify-start xl:gap-2.5 px-2 xl:px-3 py-2 rounded-xl text-xs font-medium transition-colors duration-[var(--motion-base)] ease-[var(--ease-standard)] group text-left",
                  isActive
                    ? "text-charcoal font-semibold"
                    : "text-satin-grey hover:bg-alabaster hover:text-charcoal"
                )}
              >
                <Icon
                  className={cn(
                    "w-4 h-4 shrink-0 transition-colors duration-[var(--motion-base)]",
                    isActive
                      ? "text-charcoal"
                      : "text-sandrift group-hover:text-charcoal"
                  )}
                />
                {/* 文字标签：仅在完整 Sidebar 显示 */}
                <span data-testid="nav-label" className="hidden xl:inline truncate">{item.label}</span>

                {/* Icon Rail Tooltip（仅 768–1279 显示）：hover / focus 均可见 */}
                <span
                  data-testid="nav-tooltip"
                  role="tooltip"
                  className={cn(
                    "hidden md:inline-flex xl:hidden absolute left-full top-1/2 -translate-y-1/2 ml-2",
                    "px-2 py-1 rounded-lg bg-charcoal text-white text-[11px] whitespace-nowrap",
                    "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
                    "transition-opacity duration-[var(--motion-fast)] pointer-events-none z-50"
                  )}
                >
                  {item.label}
                </span>
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
                  "relative w-full flex items-center justify-center xl:justify-start rounded-xl group text-left",
                  "overflow-hidden transition-colors duration-[var(--motion-base)] ease-[var(--ease-standard)]"
                )}
              >
                {/* 1px 品牌流光：常驻（Idle 0.8 → Hover/Active 1）；无透明段渐变 + 放大旋转层 → 连续无断口 */}
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
                      "flex items-center justify-center xl:justify-start xl:gap-2.5 px-2 xl:px-3",
                      "text-xs font-semibold transition-colors duration-[var(--motion-base)]",
                      isActive ? "bg-surface text-charcoal" : "text-charcoal"
                    )}
                  >
                    <Icon className="w-5 h-5 shrink-0" />
                    {/* 文字标签：仅在完整 Sidebar 显示 */}
                    <span data-testid="nav-label" className="hidden xl:inline truncate">{item.label}</span>

                    {/* Icon Rail Tooltip（仅 768–1279 显示）：hover / focus 均可见 */}
                    <span
                      data-testid="nav-tooltip"
                      role="tooltip"
                      className={cn(
                        "hidden md:inline-flex xl:hidden absolute left-full top-1/2 -translate-y-1/2 ml-2",
                        "px-2 py-1 rounded-lg bg-charcoal text-white text-[11px] whitespace-nowrap",
                        "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
                        "transition-opacity duration-[var(--motion-fast)] pointer-events-none z-50"
                      )}
                    >
                      {item.label}
                    </span>
                  </span>
                </button>
            );
          })}
        </div>

        {/* 全局 Action：Reminder Center（Bell，unread 小圆点）/ Settings（Modal 入口） */}
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
                className={cn(
                  "relative w-full flex items-center justify-center xl:justify-start xl:gap-2.5 px-2 xl:px-3 py-2 rounded-xl text-xs font-medium transition-colors duration-[var(--motion-base)] ease-[var(--ease-standard)] group text-left",
                  isReminders && reminderCenterOpen
                    ? "bg-alabaster text-charcoal"
                    : "text-satin-grey hover:bg-alabaster hover:text-charcoal"
                )}
              >
                <Icon className="w-4 h-4 shrink-0 transition-colors duration-[var(--motion-base)] text-sandrift group-hover:text-charcoal" />
                {/* unread 小圆点（fired && !readAt；不显示数字） */}
                {isReminders && hasUnread && (
                  <span
                    aria-hidden="true"
                    data-testid="reminder-unread-dot"
                    className="absolute top-1.5 left-1/2 -translate-x-1/2 xl:left-auto xl:right-2.5 xl:translate-x-0 w-2 h-2 rounded-full bg-danger border border-surface"
                  />
                )}
                <span data-testid="nav-label" className="hidden xl:inline truncate">{item.label}</span>
                <span
                  data-testid="nav-tooltip"
                  role="tooltip"
                  className={cn(
                    "hidden md:inline-flex xl:hidden absolute left-full top-1/2 -translate-y-1/2 ml-2",
                    "px-2 py-1 rounded-lg bg-charcoal text-white text-[11px] whitespace-nowrap",
                    "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
                    "transition-opacity duration-[var(--motion-fast)] pointer-events-none z-50"
                  )}
                >
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom Profile Card（Icon Rail 下隐藏，仅 Desktop 显示） */}
      <div className="space-y-2 hidden xl:block">
        <div className="bg-surface/50 border border-line rounded-xl p-2.5 space-y-2">
          <div className="flex items-center space-x-2.5">
            {/* 头像 fallback：无头像时显示首字/User 图标 */}
            {profileAvatarUrl ? (
              <img
                src={profileAvatarUrl}
                alt={userProfile.name || "用户"}
                className="w-8 h-8 rounded-full object-cover border border-[#CDB9AB] shrink-0"
              />
            ) : (
              <span className="w-8 h-8 rounded-full bg-pastel-mint border border-line-strong flex items-center justify-center text-[11px] font-bold text-charcoal shrink-0">
                {userProfile.name ? userProfile.name.slice(0, 1) : "用"}
              </span>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-charcoal truncate">
                  {userProfile.name || "未设置姓名"}
                </h4>
                <ChevronRight className="w-3.5 h-3.5 text-sandrift" />
              </div>
              {userProfile.college || userProfile.grade ? (
                <>
                  <p className="text-[11px] text-satin-grey truncate">
                    {userProfile.college}
                  </p>
                  <p className="text-[11px] text-sandrift truncate">
                    {userProfile.grade}
                  </p>
                </>
              ) : (
                <p className="text-[11px] text-sandrift truncate">完善个人资料</p>
              )}
            </div>
          </div>

          {/* Credit Progress */}
          <div className="space-y-1 pt-1 border-t border-line-soft">
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-satin-grey">本学期学分进度</span>
              <span className="font-semibold text-charcoal">
                {userProfile.completedCredits} / {userProfile.totalCredits} 学分
              </span>
            </div>
            <div className="w-full bg-pastel-mint rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-sandrift h-1.5 rounded-full transition-[width] duration-[var(--motion-data)] ease-[var(--ease-emphasized)]"
                style={{ width: `${creditPercentage}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
