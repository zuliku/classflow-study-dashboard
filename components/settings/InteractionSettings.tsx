"use client";

import React from "react";
import { useAppStore } from "@/store/useAppStore";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsGroup } from "@/components/settings/SettingsGroup";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsToggle } from "@/components/settings/SettingsControls";
import { getModifiedPreferenceKeys, resetPreferencePatch } from "@/lib/preferences";

/** 交互与快捷键（immediate save：开关即更新 preferences）；界面密度/动效已归入通用 */
export function InteractionSettings({ highlightedId }: { highlightedId?: string }) {
  const preferences = useAppStore((s) => s.preferences);
  const updatePreferences = useAppStore((s) => s.updatePreferences);
  const modified = new Set(getModifiedPreferenceKeys(preferences));

  return (
    <SettingsSection
      title="交互与快捷键"
      description="直接操作与键盘偏好（对应业务模块已接入）。"
    >
      <div className="text-xs" data-testid="settings-interaction">
        <SettingsGroup>
          <SettingsRow
            settingId="schedule-direct-manipulation"
            title="课表直接操作"
            description="在时间表中启用课程与学习计划的直接调整。"
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
        </SettingsGroup>
      </div>
    </SettingsSection>
  );
}
