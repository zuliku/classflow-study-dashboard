"use client";

import React from "react";
import { ChevronRight } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "@/components/layout/navItems";

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
        {/* Brand Logo：Desktop 全宽；Icon Rail 显示 Logo mark */}
        <div
          className="w-full py-1.5 px-0.5 flex items-center justify-center xl:justify-start cursor-pointer transition-opacity hover:opacity-90"
          onClick={() => setActiveTab("overview")}
          title="ClassFlow"
        >
          <img
            src="/logo.png"
            alt="ClassFlow"
            className="w-9 h-9 xl:w-full xl:h-auto xl:max-h-16 object-contain mix-blend-multiply"
          />
        </div>

        {/* Navigation Menu */}
        <nav className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() =>
                  item.id === "settings"
                    ? setSettingsModalOpen(true)
                    : setActiveTab(item.id)
                }
                aria-label={item.label}
                className={cn(
                  "relative w-full flex items-center justify-center xl:justify-start xl:space-x-2.5 px-2 xl:px-3 py-2 rounded-xl text-xs font-medium transition-colors duration-[var(--motion-base)] ease-[var(--ease-standard)] group text-left",
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
      </div>

      {/* Bottom Profile Card（Icon Rail 下隐藏，仅 Desktop 显示） */}
      <div className="space-y-2 hidden xl:block">
        <div className="bg-alabaster/70 border border-line-strong rounded-2xl p-3 space-y-2.5 shadow-subtle">
          <div className="flex items-center space-x-2.5">
            <img
              src={userProfile.avatarUrl}
              alt={userProfile.name}
              className="w-8 h-8 rounded-full object-cover border border-[#CDB9AB]"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-charcoal truncate">
                  {userProfile.name}
                </h4>
                <ChevronRight className="w-3.5 h-3.5 text-sandrift" />
              </div>
              <p className="text-[10px] text-satin-grey truncate">
                {userProfile.college}
              </p>
              <p className="text-[10px] text-sandrift truncate">
                {userProfile.grade}
              </p>
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
