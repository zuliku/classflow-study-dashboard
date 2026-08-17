"use client";

import React from "react";
import { ChevronRight } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useProfileAvatar } from "@/hooks/useProfileAvatar";
import { cn } from "@/lib/utils";

/**
 * Sidebar Profile Card（App Chrome V2.1）：
 * - 数据全部来自真实 store（userProfile + useProfileAvatar）
 * - Single-DOM Morph：Avatar 始终 mounted；Identity / Credits / Surface 由 Sidebar 的
 *   data-collapsed + data-motion-* 驱动 CSS 收束（无两套 DOM 切换）
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
      className="border border-[#CDB9AB]"
    />
  ) : (
    <span className="w-full h-full bg-pastel-mint border border-line-strong rounded-full flex items-center justify-center text-[11px] font-bold text-charcoal">
      {userProfile.name ? userProfile.name.slice(0, 1) : "用"}
    </span>
  );

  return (
    <div className="shrink-0">
      <button
        type="button"
        onClick={openProfile}
        aria-label="打开个人资料"
        className={cn(
          "sidebar-profile-surface group relative w-full flex flex-col items-stretch",
          "rounded-xl border border-line bg-surface/50 text-left",
          "hover:bg-surface hover:border-line-strong transition-colors",
          "focus-visible:outline-2 focus-visible:outline-charcoal/30"
        )}
      >
        {/* Header Row：Avatar Slot 固定 32×32（折叠时也保持真圆）；Identity 随 label morph 收束 */}
        <span className="sidebar-profile-header-row">
          <span className="sidebar-profile-avatar-slot rounded-full">{avatar}</span>
          <span className="sidebar-profile-identity flex-1 min-w-0">
            <span className="flex items-center justify-between">
              <span className="text-xs font-semibold text-charcoal truncate">
                {userProfile.name || "未设置姓名"}
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-sandrift shrink-0 ml-1 group-hover:text-charcoal transition-colors" />
            </span>
            {userProfile.college || userProfile.grade ? (
              <>
                <span className="block text-[11px] text-satin-grey truncate">
                  {userProfile.college}
                </span>
                <span className="block text-[11px] text-sandrift truncate">{userProfile.grade}</span>
              </>
            ) : (
              <span className="block text-[11px] text-sandrift truncate">完善个人资料</span>
            )}
          </span>
        </span>

        {/* Credit Progress：折叠时 max-height 0 + 上移 + 淡出 */}
        <span className="sidebar-profile-credits">
          <span className="block pt-1 mt-2 border-t border-line-soft">
            {userProfile.totalCredits > 0 ? (
              <>
                <span className="flex justify-between items-center text-[11px]">
                  <span className="text-satin-grey">本学期学分进度</span>
                  <span className="font-semibold text-charcoal">
                    {userProfile.completedCredits} / {userProfile.totalCredits} 学分
                  </span>
                </span>
                <span className="block w-full bg-pastel-mint rounded-full h-1.5 overflow-hidden mt-1">
                  <span
                    className={cn(
                      "block bg-sandrift h-1.5 rounded-full",
                      "transition-[width] duration-[var(--motion-data)] ease-[var(--ease-emphasized)]"
                    )}
                    style={{ width: `${creditPercentage}%` }}
                  />
                </span>
              </>
            ) : (
              <span className="block text-[10px] text-sandrift pt-0.5">完善学业信息</span>
            )}
          </span>
        </span>

        {/* Collapsed Tooltip：仅 collapsed 稳定态可 hover/focus 显示（morph 期间 CSS 强制隐藏） */}
        <span
          role="tooltip"
          className={cn(
            "sidebar-tooltip sidebar-profile-tooltip",
            "absolute left-full top-1/2 -translate-y-1/2 ml-2",
            "px-2 py-1 rounded-lg bg-charcoal text-white text-[11px] whitespace-nowrap",
            "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
            "transition-opacity duration-[var(--motion-fast)] pointer-events-none z-50"
          )}
        >
          {userProfile.name || "未设置姓名"} · 个人资料
        </span>
      </button>
    </div>
  );
}
