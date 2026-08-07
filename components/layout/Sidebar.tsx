"use client";

import React from "react";
import {
  LayoutDashboard,
  CalendarDays,
  ClipboardCheck,
  FolderKanban,
  BarChart3,
  Users2,
  Settings,
  ChevronRight,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { NavTab } from "@/types";
import { cn } from "@/lib/utils";

const NAV_ITEMS: { id: NavTab; label: string; icon: React.ElementType }[] = [
  { id: "overview", label: "总览", icon: LayoutDashboard },
  { id: "timetable", label: "我的课表", icon: CalendarDays },
  { id: "assignments", label: "任务与 DDL", icon: ClipboardCheck },
  { id: "courses", label: "课程资料", icon: FolderKanban },
  { id: "analytics", label: "学习统计", icon: BarChart3 },
  { id: "group", label: "小组协作", icon: Users2 },
  { id: "settings", label: "设置", icon: Settings },
];

export function Sidebar() {
  const { activeTab, setActiveTab, userProfile } = useAppStore();

  const creditPercentage =
    userProfile.totalCredits > 0
      ? Math.round((userProfile.completedCredits / userProfile.totalCredits) * 100)
      : 0;

  return (
    <aside className="w-52 xl:w-56 h-screen bg-[#F7F5F5] border-r border-[#E7E3DD] flex flex-col justify-between p-3.5 sticky top-0 select-none z-20 shrink-0">
      {/* Top Section */}
      <div className="space-y-3">
        {/* Brand Logo filling top-left area cleanly matching Figure 1 red box */}
        <div
          className="w-full py-1.5 px-0.5 flex items-center justify-start cursor-pointer transition-opacity hover:opacity-90"
          onClick={() => setActiveTab("overview")}
        >
          <img
            src="/logo.png"
            alt="ClassFlow"
            className="w-full h-auto max-h-16 object-contain mix-blend-multiply"
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
                onClick={() => setActiveTab(item.id)}
                className={cn(
                  "relative w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors duration-[var(--motion-base)] ease-[var(--ease-standard)] group text-left",
                  isActive
                    ? "bg-[#E3E6E0] text-charcoal font-semibold shadow-subtle"
                    : "text-[#676268] hover:bg-[#F0EBE1] hover:text-charcoal"
                )}
              >
                {/* Active 指示条：opacity + scaleY 过渡 */}
                <span
                  className={cn(
                    "absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-full bg-charcoal",
                    "transition-all duration-[var(--motion-base)] ease-[var(--ease-standard)]",
                    isActive ? "opacity-100 scale-y-100" : "opacity-0 scale-y-50"
                  )}
                  aria-hidden="true"
                />
                <Icon
                  className={cn(
                    "w-4 h-4 transition-colors duration-[var(--motion-base)]",
                    isActive
                      ? "text-charcoal"
                      : "text-[#8C827A] group-hover:text-charcoal"
                  )}
                />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Profile Card */}
      <div className="space-y-2">
        <div className="bg-[#F0EBE1]/70 border border-[#E0D7C6] rounded-2xl p-3 space-y-2.5 shadow-subtle">
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
                <ChevronRight className="w-3.5 h-3.5 text-[#8C827A]" />
              </div>
              <p className="text-[10px] text-[#676268] truncate">
                {userProfile.college}
              </p>
              <p className="text-[10px] text-[#8C827A] truncate">
                {userProfile.grade}
              </p>
            </div>
          </div>

          {/* Credit Progress */}
          <div className="space-y-1 pt-1 border-t border-[#E0D7C6]/60">
            <div className="flex justify-between items-center text-[10px]">
              <span className="text-[#676268]">本学期学分进度</span>
              <span className="font-semibold text-charcoal">
                {userProfile.completedCredits} / {userProfile.totalCredits} 学分
              </span>
            </div>
            <div className="w-full bg-[#E3E6E0] rounded-full h-1.5 overflow-hidden">
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
