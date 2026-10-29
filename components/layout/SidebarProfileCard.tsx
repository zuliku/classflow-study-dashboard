"use client";

import React, { useMemo } from "react";
import { ChevronRight } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useProfileAvatar } from "@/hooks/useProfileAvatar";
import { getTodayTaskProgress } from "@/lib/tasks/todayTaskProgress";
import { cn } from "@/lib/utils";

/**
 * Sidebar Profile Card（Workflow UX Sidebar Productization V2.1 视觉回调）：
 * - 恢复 43d1bc7 的独立 Profile Surface 形态：rounded-xl / border-line /
 *   bg-surface/50 → hover bg-surface + border-line-strong（克制账户区域感）
 * - Credit Progress 永久移除（学习数据不属于 App Chrome；完整学分信息保留在
 *   Store / Settings 中，仅不在此展示），对应 credits CSS 保持删除
 * - Workflow UX Sidebar Productization V2.2：加回底部信息区 = 「今日任务进度」
 *   （DDL isToday 口径，done = submitted/completed；见 lib/tasks/todayTaskProgress.ts）。
 *   Collapse morph 复用 grid-template-rows choreography（类名 sidebar-profile-progress，
 *   不再使用 credits 命名）；进度条 width 使用 --motion-data（Data motion 语义）。
 * - Single-DOM Morph：Avatar 始终 mounted（32×32）；Identity 由 data-collapsed +
 *   data-motion-* 驱动 opacity/translateX 收束；无 scale / crossfade / height tween
 * - 信息层级：姓名 + ChevronRight → 学院 → 年级（224px 宽度下两行 meta 扫描性更好；
 *   college / grade 都缺失 → 「完善个人资料」，不伪造内容）
 * - 整卡可点击 → Settings → profile section（settingsTargetSection 机制）
 */
export function SidebarProfileCard({ collapsed }: { collapsed: boolean }) {
  const userProfile = useAppStore((s) => s.userProfile);
  const setSettingsModalOpen = useAppStore((s) => s.setSettingsModalOpen);
  const setSettingsTargetSection = useAppStore((s) => s.setSettingsTargetSection);
  const profileAvatarUrl = useProfileAvatar();
  const assignments = useAppStore((s) => s.assignments);
  const todayProgress = useMemo(() => getTodayTaskProgress(assignments), [assignments]);

  const openProfile = () => {
    setSettingsModalOpen(true);
    // 深链直达姓名行（section 仅作回退）
    setSettingsTargetSection("profile", "profile-name");
  };

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

        {/* 今日任务进度（Workflow UX Sidebar Productization V2.2）：
            纯信息展示——点击整卡仍打开 Settings → profile，不跳任务工作区。
            Collapse morph：grid-template-rows 1fr→0fr + opacity/translateY
            （collapse 优先淡出 / expand 延迟进入，沿 data-motion-direction choreography）。 */}
        <span className="sidebar-profile-progress">
          <span className="sidebar-profile-progress-inner">
            <span className="block pt-1 mt-2 border-t border-line-soft">
              <span className="flex justify-between items-center text-[11px]">
                <span className="text-satin-grey">今日任务进度</span>
                <span className="font-semibold text-charcoal tabular-nums">
                  {todayProgress.done} / {todayProgress.total} 项
                </span>
              </span>
              {/* Data motion：width → --motion-data / --ease-emphasized（柔和反馈，非 press） */}
              <span className="block w-full bg-pastel-mint rounded-full h-1.5 overflow-hidden mt-1">
                <span
                  className={cn(
                    "block bg-sandrift h-1.5 rounded-full",
                    "transition-[width] duration-[var(--motion-data)] ease-[var(--ease-emphasized)]"
                  )}
                  style={{ width: `${todayProgress.percentage}%` }}
                />
              </span>
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
    </div>
  );
}
