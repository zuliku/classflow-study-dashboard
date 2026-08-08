"use client";

import React, { useState } from "react";
import { SettingsSection } from "@/types";
import { SettingsNav, SETTINGS_NAV, ABOUT_NAV } from "@/components/settings/SettingsNav";
import { ProfileSettings } from "@/components/settings/ProfileSettings";
import { SemesterSettings } from "@/components/settings/SemesterSettings";
import { TaskSettings } from "@/components/settings/TaskSettings";
import { InteractionSettings } from "@/components/settings/InteractionSettings";
import { DataSettings } from "@/components/settings/DataSettings";
import { AboutSettings } from "@/components/settings/AboutSettings";
import { cn } from "@/lib/utils";

/**
 * 设置中心内容：在 SettingsModal 的固定高度内铺满。
 * <768：横向可滚动 section tabs，内容自然纵向滚动。
 * ≥768：左侧固定导航列（非 sticky，不随 detail 滚动），右侧 detail 独立滚动。
 * 切换 section 只替换右侧内容：Modal / 左侧导航 / 标题位置完全不动。
 * 当前 section 是瞬时 UI 状态，不持久化。
 */
export function SettingsView() {
  const [section, setSection] = useState<SettingsSection>("profile");

  return (
    <div className="flex-1 min-h-0 flex flex-col md:flex-row" data-testid="settings-view">
      {/* 桌面/平板：左侧设置导航（固定列，shrink-0 / h-full，不使用 sticky） */}
      <div className="hidden md:flex md:flex-col md:shrink-0 md:h-full md:w-[200px] md:p-3 md:border-r md:border-line-soft md:overflow-y-auto">
        <SettingsNav active={section} onSelect={setSection} />
      </div>

      {/* Mobile：横向可滚动 section tabs */}
      <div className="md:hidden shrink-0 px-4 pt-3 pb-2 overflow-x-auto border-b border-line-soft">
        <div className="flex items-center gap-1 w-max pb-1">
          {[...SETTINGS_NAV, ABOUT_NAV].map((item) => {
            const Icon = item.icon;
            const isActive = section === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-medium whitespace-nowrap transition-colors duration-[var(--motion-fast)]",
                  isActive
                    ? "bg-pastel-mint text-charcoal font-semibold"
                    : "text-satin-grey hover:bg-alabaster"
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Detail Pane：唯一滚动区（min-h-0 + overflow-y-auto），内容用满右栏宽度；
          所有 section 常驻挂载（切换不卸载，保证 Profile/Semester 的本地 dirty state 保留，
          只有「放弃更改」才重置） */}
      <div className="flex-1 min-w-0 min-h-0 overflow-y-auto p-4 md:p-5">
        <div className={cn(section === "profile" && "ux-fade")} hidden={section !== "profile"}>
          <ProfileSettings />
        </div>
        <div className={cn(section === "semester" && "ux-fade")} hidden={section !== "semester"}>
          <SemesterSettings />
        </div>
        <div className={cn(section === "tasks" && "ux-fade")} hidden={section !== "tasks"}>
          <TaskSettings />
        </div>
        <div className={cn(section === "interaction" && "ux-fade")} hidden={section !== "interaction"}>
          <InteractionSettings />
        </div>
        <div className={cn(section === "data" && "ux-fade")} hidden={section !== "data"}>
          <DataSettings />
        </div>
        <div className={cn(section === "about" && "ux-fade")} hidden={section !== "about"}>
          <AboutSettings />
        </div>
      </div>
    </div>
  );
}
