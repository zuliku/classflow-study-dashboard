"use client";

import React from "react";
import { ChevronRight } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";
import {
  MAIN_NAV_ITEMS,
  AI_NAV_ITEMS,
  GLOBAL_NAV_ACTIONS,
} from "@/components/layout/navItems";

export function Sidebar() {
  const { activeTab, setActiveTab, setSettingsModalOpen, userProfile } = useAppStore();

  const creditPercentage =
    userProfile.totalCredits > 0
      ? Math.round((userProfile.completedCredits / userProfile.totalCredits) * 100)
      : 0;

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
          className="w-full h-10 px-0.5 flex items-center justify-center cursor-pointer transition-opacity hover:opacity-90"
          onClick={() => setActiveTab("overview")}
          title="ClassFlow"
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
        <nav className="space-y-0.5">
          {MAIN_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                aria-label={item.label}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "relative w-full flex items-center justify-center xl:justify-start xl:gap-2.5 px-2 xl:px-3 py-2 rounded-xl text-xs font-medium transition-colors duration-[var(--motion-base)] ease-[var(--ease-standard)] group text-left",
                  isActive
                    ? "bg-pastel-mint text-charcoal font-semibold shadow-subtle"
                    : "text-satin-grey hover:bg-alabaster hover:text-charcoal"
                )}
              >
                {/* Active 指示条：opacity + scaleY 过渡 */}
                <span
                  className={cn(
                    "absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-full bg-charcoal",
                    "transition-[opacity,transform] duration-[var(--motion-base)] ease-[var(--ease-standard)]",
                    isActive ? "opacity-100 scale-y-100" : "opacity-0 scale-y-50"
                  )}
                  aria-hidden="true"
                />
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
                {/* 1px 品牌色 perimeter：Idle 静默 / Hover 慢速流动 / Active 静态细边 */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute inset-0 kiro-ring pointer-events-none",
                    "transition-opacity duration-[var(--motion-fast)]",
                    isActive
                      ? "opacity-100"
                      : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                  )}
                />
                <span
                  className={cn(
                    "absolute inset-0 kiro-ring kiro-ring-animated pointer-events-none opacity-0",
                    "transition-opacity duration-[var(--motion-fast)]",
                    "group-hover:opacity-100 group-focus-visible:opacity-100",
                    isActive && "hidden"
                  )}
                />
                {/* 内容层：m-px 留出 1px 品牌色环 */}
                <span
                  className={cn(
                    "relative m-px w-full h-11 rounded-[11px] bg-[#F7F5F5]",
                    "flex items-center justify-center xl:justify-start xl:gap-2.5 px-2 xl:px-3",
                    "text-xs font-semibold transition-colors duration-[var(--motion-base)]",
                    isActive ? "bg-pastel-mint text-charcoal" : "text-charcoal"
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
                {/* Active 指示条（保留统一 active 语义） */}
                <span
                  className={cn(
                    "absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full bg-charcoal",
                    "transition-[opacity,transform] duration-[var(--motion-base)] ease-[var(--ease-standard)]",
                    isActive ? "opacity-100 scale-y-100" : "opacity-0 scale-y-50"
                  )}
                  aria-hidden="true"
                />
              </button>
            );
          })}
        </div>

        {/* 全局 Action：设置（Modal 入口，不改变 activeTab）；与 AI 区域以 border-t 分隔 */}
        <div className="pt-1 mt-1 border-t border-line-soft space-y-0.5">
          {GLOBAL_NAV_ACTIONS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setSettingsModalOpen(true)}
                aria-label={item.label}
                className={cn(
                  "relative w-full flex items-center justify-center xl:justify-start xl:gap-2.5 px-2 xl:px-3 py-2 rounded-xl text-xs font-medium transition-colors duration-[var(--motion-base)] ease-[var(--ease-standard)] group text-left",
                  "text-satin-grey hover:bg-alabaster hover:text-charcoal"
                )}
              >
                <Icon className="w-4 h-4 shrink-0 transition-colors duration-[var(--motion-base)] text-sandrift group-hover:text-charcoal" />
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
        <div className="bg-alabaster/70 border border-line-strong rounded-2xl p-3 space-y-2.5 shadow-subtle">
          <div className="flex items-center space-x-2.5">
            {/* 头像 fallback：无 avatarUrl 时显示首字/User 图标 */}
            {userProfile.avatarUrl ? (
              <img
                src={userProfile.avatarUrl}
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
                  <p className="text-[10px] text-satin-grey truncate">
                    {userProfile.college}
                  </p>
                  <p className="text-[10px] text-sandrift truncate">
                    {userProfile.grade}
                  </p>
                </>
              ) : (
                <p className="text-[10px] text-sandrift truncate">完善个人资料</p>
              )}
            </div>
          </div>

          {/* Credit Progress */}
          <div className="space-y-1 pt-1 border-t border-line-strong/60">
            <div className="flex justify-between items-center text-[10px]">
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
