"use client";

import React from "react";
import { useAppStore } from "@/store/useAppStore";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsGroup } from "@/components/settings/SettingsGroup";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsToggle, SettingsSelect, SettingsSegmentedControl } from "@/components/settings/SettingsControls";
import {
  MOTION_PREFERENCES,
  CONTENT_DENSITIES,
  getModifiedPreferenceKeys,
  resetPreferencePatch,
} from "@/lib/preferences";
import type { ContentDensity } from "@/types";

/** 交互与快捷键（immediate save：开关即更新 preferences） */
export function InteractionSettings({ highlightedId }: { highlightedId?: string }) {
  const preferences = useAppStore((s) => s.preferences);
  const updatePreferences = useAppStore((s) => s.updatePreferences);
  const modified = new Set(getModifiedPreferenceKeys(preferences));

  return (
    <SettingsSection
      title="交互与快捷键"
      description="直接操作、键盘与动效偏好（对应业务模块已接入）。"
    >
      <div className="text-xs" data-testid="settings-interaction">
        <SettingsGroup>
          <SettingsRow
          settingId="schedule-direct-manipulation"
          title="课表直接操作"
          description="在完整课表中启用拖动调整与缩放排课。"
          modified={modified.has("enableScheduleDirectManipulation")}
          onReset={() =>
            updatePreferences(resetPreferencePatch("enableScheduleDirectManipulation"))
          }
          resetAriaLabel="将课表直接操作恢复默认"
          highlighted={highlightedId === "schedule-direct-manipulation"}
        >
          <SettingsToggle
            checked={preferences.enableScheduleDirectManipulation}
            onChange={(v) => updatePreferences({ enableScheduleDirectManipulation: v })}
            label="课表直接操作"
          />
        </SettingsRow>

        <SettingsRow
          settingId="ddl-direct-manipulation"
          title="DDL 直接操作"
          description="在日历中启用拖动调整截止日期。"
          modified={modified.has("enableDDLDirectManipulation")}
          onReset={() => updatePreferences(resetPreferencePatch("enableDDLDirectManipulation"))}
          resetAriaLabel="将 DDL 直接操作恢复默认"
          highlighted={highlightedId === "ddl-direct-manipulation"}
        >
          <SettingsToggle
            checked={preferences.enableDDLDirectManipulation}
            onChange={(v) => updatePreferences({ enableDDLDirectManipulation: v })}
            label="DDL 直接操作"
          />
        </SettingsRow>

        <SettingsRow
          settingId="single-key-shortcuts"
          title="启用单键快捷键"
          description="在未编辑文本时启用 N、J/K、X 等快速操作；标准键盘操作（方向键、Enter、Tab 与 Cmd/Ctrl 组合）始终可用。"
          modified={modified.has("enableSingleKeyShortcuts")}
          onReset={() => updatePreferences(resetPreferencePatch("enableSingleKeyShortcuts"))}
          resetAriaLabel="将单键快捷键恢复默认"
          highlighted={highlightedId === "single-key-shortcuts"}
        >
          <SettingsToggle
            checked={preferences.enableSingleKeyShortcuts}
            onChange={(v) => updatePreferences({ enableSingleKeyShortcuts: v })}
            label="启用单键快捷键"
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
      </div>
    </SettingsSection>
  );
}
