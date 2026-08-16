"use client";

import React from "react";
import { ChevronRight } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useProfileAvatar } from "@/hooks/useProfileAvatar";
import { cn } from "@/lib/utils";

/**
 * Sidebar Profile Card（App Chrome V2）：
 * - 数据全部来自真实 store（userProfile + useProfileAvatar）
 * - Expanded：头像 / 姓名 / 学院专业 / 年级 / Chevron + divider + 学分进度
 * - Collapsed：仅头像，hover/focus tooltip（姓名 · 个人资料）
 * - 整卡可点击 → Settings → profile section（settingsTargetSection 机制，不创建 Profile Drawer）
 * - totalCredits <= 0：不显示 0/0 进度，改为低权重「完善学业信息」
 * - 不添加 account menu / logout / cloud / membership / online status（无真实 Domain）
 */
export function SidebarProfileCard({ collapsed }: { collapsed: boolean }) {
  const userProfile = useAppStore((s) => s.userProfile);
  const setSettingsModalOpen = useAppStore((s) => s.setSettingsModalOpen);
  const setSettingsTargetSection = useAppStore((s) => s.setSettingsTargetSection);
  const profileAvatarUrl = useProfileAvatar();

  const openProfile = () => {
    setSettingsModalOpen(true);
    setSettingsTargetSection("profile");
  };

  const creditPercentage =
    userProfile.totalCredits > 0
      ? Math.min(
          Math.round((userProfile.completedCredits / userProfile.totalCredits) * 100),
          100
        )
      : 0;

  const avatar = profileAvatarUrl ? (
    <img
      src={profileAvatarUrl}
      alt={userProfile.name || "用户"}
      className="w-8 h-8 rounded-full object-cover border border-[#CDB9AB] shrink-0"
    />
  ) : (
    <span className="w-8 h-8 rounded-full bg-pastel-mint border border-line-strong flex items-center justify-center text-[11px] font-bold text-charcoal shrink-0">
      {userProfile.name ? userProfile.name.slice(0, 1) : "用"}
    </span>
  );

  return (
    <div className="shrink-0 space-y-2">
      {/* Collapsed：仅头像 entry（hover/focus tooltip） */}
      {collapsed ? (
        <button
          type="button"
          onClick={openProfile}
          aria-label={`${userProfile.name || "用户"} · 个人资料`}
          className="group relative w-full flex items-center justify-center py-1.5 rounded-xl focus-visible:outline-2 focus-visible:outline-charcoal/30"
        >
          {avatar}
          <span
            role="tooltip"
            className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2 py-1 rounded-lg bg-charcoal text-white text-[11px] whitespace-nowrap opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-[var(--motion-fast)] pointer-events-none z-50"
          >
            {userProfile.name || "未设置姓名"} · 个人资料
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={openProfile}
          aria-label="打开个人资料"
          className="w-full bg-surface/50 border border-line rounded-xl p-2.5 space-y-2 text-left transition-colors hover:bg-surface hover:border-line-strong focus-visible:outline-2 focus-visible:outline-charcoal/30 group"
        >
          <div className="flex items-center space-x-2.5">
            {avatar}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-charcoal truncate">
                  {userProfile.name || "未设置姓名"}
                </h4>
                <ChevronRight className="w-3.5 h-3.5 text-sandrift group-hover:text-charcoal transition-colors" />
              </div>
              {userProfile.college || userProfile.grade ? (
                <>
                  <p className="text-[11px] text-satin-grey truncate">{userProfile.college}</p>
                  <p className="text-[11px] text-sandrift truncate">{userProfile.grade}</p>
                </>
              ) : (
                <p className="text-[11px] text-sandrift truncate">完善个人资料</p>
              )}
            </div>
          </div>

          {/* 学分进度：totalCredits <= 0 时降级为「完善学业信息」，不显示 0 / 0 */}
          <div className="space-y-1 pt-1 border-t border-line-soft">
            {userProfile.totalCredits > 0 ? (
              <>
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-satin-grey">本学期学分进度</span>
                  <span className="font-semibold text-charcoal">
                    {userProfile.completedCredits} / {userProfile.totalCredits} 学分
                  </span>
                </div>
                <div className="w-full bg-pastel-mint rounded-full h-1.5 overflow-hidden">
                  <div
                    className={cn(
                      "bg-sandrift h-1.5 rounded-full",
                      "transition-[width] duration-[var(--motion-data)] ease-[var(--ease-emphasized)]"
                    )}
                    style={{ width: `${creditPercentage}%` }}
                  />
                </div>
              </>
            ) : (
              <p className="text-[10px] text-sandrift pt-0.5">完善学业信息</p>
            )}
          </div>
        </button>
      )}
    </div>
  );
}
