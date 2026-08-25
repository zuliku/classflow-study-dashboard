"use client";

import React from "react";
import { ChevronRight } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useProfileAvatar } from "@/hooks/useProfileAvatar";
import { cn } from "@/lib/utils";

/**
 * Sidebar Profile Row（Workflow UX Sidebar Productization V2）：
 * - 去 Dashboard Card 化：transparent base + hover bg-alabaster/70，无默认 border / shadow；
 *   视觉 = 成熟桌面产品的 Account Row，高度 ~48px，不超过 Main Navigation 的视觉重量
 * - 数据全部来自真实 store（userProfile + useProfileAvatar）；不伪造 online/membership 等
 * - Single-DOM Morph：Avatar 始终 mounted；Identity 由 data-collapsed + data-motion-* 驱动
 * - 学分 progress 已从 Sidebar 移除（学习数据不属于 App Chrome；Store / Settings 保留）
 * - 整行可点击 → Settings → profile section（settingsTargetSection 机制）
 * - Collapsed：仅 Avatar + tooltip「用户名 · 个人资料」
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

  const metaLine = [userProfile.college, userProfile.grade]
    .filter((v): v is string => !!v)
    .join(" · ");

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
    <button
      type="button"
      onClick={openProfile}
      aria-label="打开个人资料"
      className={cn(
        "sidebar-profile-surface group relative w-full flex items-center gap-2.5 text-left",
        "rounded-lg text-left",
        "hover:bg-alabaster/70 transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]",
        "focus-visible:outline-2 focus-visible:outline-charcoal/30"
      )}
    >
      {/* Header Row：Avatar Slot 固定 32×32（折叠时也保持真圆）；Identity 随 label morph 收束 */}
      <span className="sidebar-profile-header-row min-w-0 flex-1">
        <span className="sidebar-profile-avatar-slot rounded-full">{avatar}</span>
        <span className="sidebar-profile-identity flex-1 min-w-0">
          <span className="flex items-center justify-between gap-1">
            <span className="text-xs font-semibold text-charcoal truncate">
              {userProfile.name || "未设置姓名"}
            </span>
            <ChevronRight className="w-3.5 h-3.5 text-sandrift shrink-0 group-hover:text-charcoal transition-colors" />
          </span>
          <span className="block text-[10px] text-satin-grey truncate">
            {metaLine || "完善个人资料"}
          </span>
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
  );
}
