"use client";

import React from "react";
import {
  LayoutDashboard,
  CalendarDays,
  ClipboardCheck,
  FolderKanban,
  BarChart3,
  Settings,
  FileText,
  ChevronRight,
  BookOpen,
} from "lucide-react";
import { useAppStore, NavTab } from "@/store/useAppStore";
import { cn } from "@/lib/utils";

const NAV_ITEMS: { id: NavTab; label: string; icon: React.ElementType }[] = [
  { id: "overview", label: "总览", icon: LayoutDashboard },
  { id: "timetable", label: "我的课表", icon: CalendarDays },
  { id: "assignments", label: "作业 DDL", icon: ClipboardCheck },
  { id: "courses", label: "课程资料", icon: FolderKanban },
  { id: "analytics", label: "学习统计", icon: BarChart3 },
  { id: "settings", label: "设置", icon: Settings },
];

export function Sidebar() {
  const { activeTab, setActiveTab, userProfile } = useAppStore();

  const creditPercentage = Math.round(
    (userProfile.completedCredits / userProfile.totalCredits) * 100
  );

  return (
    <aside className="w-64 h-screen bg-[#F7F5F5] border-r border-[#E7E3DD] flex flex-col justify-between p-4 sticky top-0 select-none z-20">
      {/* Top Section */}
      <div className="space-y-6">
        {/* Brand Logo */}
        <div className="flex items-center space-x-3 px-3 py-2">
          <div className="w-9 h-9 rounded-xl bg-charcoal flex items-center justify-center text-white shadow-subtle">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-semibold text-lg tracking-tight text-charcoal flex items-center">
              ClassFlow
            </h1>
            <p className="text-[11px] text-[#8C827A] tracking-wider uppercase">
              Academic Hub
            </p>
          </div>
        </div>

        {/* Navigation Menu */}
        <nav className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={cn(
                  "w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group text-left",
                  isActive
                    ? "bg-[#E3E6E0] text-charcoal shadow-subtle font-semibold"
                    : "text-[#676268] hover:bg-[#F0EBE1] hover:text-charcoal"
                )}
              >
                <Icon
                  className={cn(
                    "w-4 h-4 transition-colors",
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
      <div className="space-y-3">
        <div className="bg-[#F0EBE1]/70 border border-[#E0D7C6] rounded-2xl p-3.5 space-y-3 shadow-subtle">
          <div className="flex items-center space-x-3">
            <img
              src={userProfile.avatarUrl}
              alt={userProfile.name}
              className="w-10 h-10 rounded-full object-cover border border-[#CDB9AB]"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-charcoal truncate">
                  {userProfile.name}
                </h4>
                <ChevronRight className="w-3.5 h-3.5 text-[#8C827A]" />
              </div>
              <p className="text-[11px] text-[#676268] truncate">
                {userProfile.college}
              </p>
              <p className="text-[10px] text-[#8C827A] truncate">
                {userProfile.grade}
              </p>
            </div>
          </div>

          {/* Credit Progress */}
          <div className="space-y-1.5 pt-1 border-t border-[#E0D7C6]/60">
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-[#676268]">本学期学分进度</span>
              <span className="font-semibold text-charcoal">
                {userProfile.completedCredits} / {userProfile.totalCredits} 学分
              </span>
            </div>
            <div className="w-full bg-[#E3E6E0] rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-sandrift h-1.5 rounded-full transition-all duration-500"
                style={{ width: `${creditPercentage}%` }}
              />
            </div>
          </div>

          {/* Cultivation Program Button */}
          <button className="w-full mt-1 flex items-center justify-center space-x-1.5 py-1.5 bg-white hover:bg-[#F7F5F5] text-[#313032] border border-[#D5CBC0] rounded-xl text-[11px] font-medium transition-colors">
            <FileText className="w-3 h-3 text-[#A48F82]" />
            <span>查看培养方案</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
