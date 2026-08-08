"use client";

import React, { useState } from "react";
import { Settings as SettingsIcon } from "lucide-react";
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
 * Settings Center：左侧设置导航 + 右侧当前页面。
 * <768：横向可滚动 section tabs（不强制双栏）。
 * ≥768：左侧固定导航（768-1023 窄栏，≥1024 190px）。
 * 当前 section 是瞬时 UI 状态，不持久化。
 */
export function SettingsView() {
  const [section, setSection] = useState<SettingsSection>("profile");

  return (
    <div className="w-full space-y-4 pb-10" data-testid="settings-view">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-charcoal flex items-center gap-2">
            <SettingsIcon className="w-4 h-4 text-[#A48F82]" />
            设置
          </h2>
          <p className="text-xs text-sandrift mt-0.5">
            账户、学期、偏好与本地数据管理
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[190px_1fr] gap-5 items-start">
        {/* 桌面/平板：左侧设置导航（sticky） */}
        <div className="hidden md:block md:sticky md:top-20">
          <SettingsNav active={section} onSelect={setSection} />
        </div>

        {/* Mobile：横向可滚动 section tabs */}
        <div className="md:hidden -mx-4 px-4 overflow-x-auto">
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

        {/* Detail Pane：内容宽控制在合理范围；所有 section 常驻挂载（切换不卸载，
            保证 Profile/Semester 的本地 dirty state 保留，只有「放弃更改」才重置） */}
        <div className="min-w-0 max-w-[860px] w-full">
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
    </div>
  );
}
