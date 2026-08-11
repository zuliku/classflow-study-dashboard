"use client";

import React from "react";
import { useAppStore } from "@/store/useAppStore";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsGroup } from "@/components/settings/SettingsGroup";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsSegmentedControl, SettingsSelect } from "@/components/settings/SettingsControls";
import {
  STARTUP_VIEWS,
  MOTION_PREFERENCES,
  CONTENT_DENSITIES,
  getModifiedPreferenceKeys,
  resetPreferencePatch,
} from "@/lib/preferences";
import type { StartupView, ContentDensity } from "@/types";

const STARTUP_VIEW_LABELS: Record<StartupView, string> = {
  overview: "总览",
  timetable: "课表",
  assignments: "任务",
  last: "上次使用的位置",
};

/**
 * 通用（Settings V3 IA）：只保留全局产品行为偏好。
 * Dashboard / 数据状态 / 导航快捷入口已迁出（数据状态见「数据与存储 → 数据状态」）。
 */
export function GeneralSettings({ highlightedId }: { highlightedId?: string }) {
  const preferences = useAppStore((s) => s.preferences);
  const updatePreferences = useAppStore((s) => s.updatePreferences);
  const modified = new Set(getModifiedPreferenceKeys(preferences));

  return (
    <div className="space-y-6" data-testid="settings-general">
      <SettingsSection
        title="通用"
        description="全局产品行为偏好：启动位置、界面密度与动效。"
      >
        <SettingsGroup>
          <SettingsRow
            settingId="startup-view"
            title="默认打开位置"
            description="下次打开 ClassFlow 时进入的位置。"
            modified={modified.has("startupView")}
            onReset={() => updatePreferences(resetPreferencePatch("startupView"))}
            resetAriaLabel="将默认打开位置恢复默认"
            highlighted={highlightedId === "startup-view"}
          >
            <SettingsSegmentedControl<StartupView>
              value={preferences.startupView}
              onChange={(v) => updatePreferences({ startupView: v })}
              options={STARTUP_VIEWS.map((v) => ({ value: v, label: STARTUP_VIEW_LABELS[v] }))}
              ariaLabel="默认打开位置"
            />
          </SettingsRow>

          <SettingsRow
            settingId="content-density"
            title="界面密度"
            description="任务工作区、课程列表与命令中心的行高与间距。"
            modified={modified.has("contentDensity")}
            onReset={() => updatePreferences(resetPreferencePatch("contentDensity"))}
            resetAriaLabel="将界面密度恢复默认"
            highlighted={highlightedId === "content-density"}
          >
            <SettingsSegmentedControl<ContentDensity>
              value={preferences.contentDensity}
              onChange={(v) => updatePreferences({ contentDensity: v })}
              ariaLabel="界面密度"
              options={CONTENT_DENSITIES.map((d) => ({
                value: d,
                label: d === "comfortable" ? "舒适" : "紧凑",
              }))}
            />
          </SettingsRow>

          <SettingsRow
            settingId="motion-preference"
            title="动效偏好"
            description="界面动画强度；跟随系统时尊重系统减弱动效设置。"
            modified={modified.has("motionPreference")}
            onReset={() => updatePreferences(resetPreferencePatch("motionPreference"))}
            resetAriaLabel="将动效偏好恢复默认"
            highlighted={highlightedId === "motion-preference"}
          >
            <SettingsSelect
              value={preferences.motionPreference}
              onChange={(v) =>
                updatePreferences({ motionPreference: v as "system" | "full" | "reduced" })
              }
              ariaLabel="动效偏好"
              options={MOTION_PREFERENCES.map((m) => ({
                value: m,
                label: m === "system" ? "跟随系统" : m === "full" ? "完整动效" : "减少动效",
              }))}
            />
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>
    </div>
  );
}
