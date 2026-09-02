"use client";

import React from "react";
import { useAppStore } from "@/store/useAppStore";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsGroup } from "@/components/settings/SettingsGroup";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsSegmentedControl, SettingsToggle } from "@/components/settings/SettingsControls";
import { getModifiedPreferenceKeys, resetPreferencePatch } from "@/lib/preferences";

export function FocusSettings({ highlightedId }: { highlightedId?: string }) {
  const preferences = useAppStore((s) => s.preferences);
  const updatePreferences = useAppStore((s) => s.updatePreferences);
  const modified = new Set(getModifiedPreferenceKeys(preferences));

  return (
    <SettingsSection title="专注与学习" description="专注会话的默认时长与完成提示。">
      <div className="text-xs space-y-4" data-testid="settings-focus">
        <SettingsGroup title="专注会话">
          <SettingsRow
            settingId="focus-default-minutes"
            title="默认专注时长"
            description="Kiro 未指定时长时的默认值；也作为快捷选择的首选。"
            modified={modified.has("focusDefaultMinutes")}
            onReset={() => updatePreferences(resetPreferencePatch("focusDefaultMinutes"))}
            resetAriaLabel="将默认专注时长恢复默认"
            highlighted={highlightedId === "focus-default-minutes"}
          >
            <SettingsSegmentedControl<number>
              value={preferences.focusDefaultMinutes}
              onChange={(v) => updatePreferences({ focusDefaultMinutes: v as 15 | 25 | 45 | 60 })}
              ariaLabel="默认专注时长"
              options={[
                { value: 15, label: "15 分钟" },
                { value: 25, label: "25 分钟" },
                { value: 45, label: "45 分钟" },
                { value: 60, label: "60 分钟" },
              ]}
            />
          </SettingsRow>

          <SettingsRow
            settingId="focus-sound-enabled"
            title="完成提示音"
            description="专注结束时播放本地提示音；关闭后仅保留界面 Toast。"
            modified={modified.has("focusSoundEnabled")}
            onReset={() => updatePreferences(resetPreferencePatch("focusSoundEnabled"))}
            resetAriaLabel="将完成提示音恢复默认"
            highlighted={highlightedId === "focus-sound-enabled"}
          >
            <SettingsToggle
              checked={preferences.focusSoundEnabled}
              onChange={(v) => updatePreferences({ focusSoundEnabled: v })}
              label="完成提示音"
            />
          </SettingsRow>

          <SettingsRow
            settingId="focus-sound-volume"
            title="提示音量"
            description="完成提示音的音量大小。"
            modified={modified.has("focusSoundVolume")}
            onReset={() => updatePreferences(resetPreferencePatch("focusSoundVolume"))}
            resetAriaLabel="将提示音量恢复默认"
            highlighted={highlightedId === "focus-sound-volume"}
          >
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={100}
                value={preferences.focusSoundVolume}
                onChange={(e) => updatePreferences({ focusSoundVolume: Number(e.target.value) })}
                className="w-32 accent-charcoal"
                aria-label="提示音量"
                disabled={!preferences.focusSoundEnabled}
              />
              <span className="text-[11px] font-bold text-sandrift w-8 text-right">{preferences.focusSoundVolume}%</span>
            </div>
          </SettingsRow>

          <SettingsRow settingId="focus-tracking" title="实时专注计时" description="FocusSession 记录真实的专注时间；暂停期间不计入，结束后写入实际专注时长。">
            <span className="px-2 py-0.5 rounded-full bg-pastel-mint text-[10px] font-bold text-charcoal shrink-0">已启用</span>
          </SettingsRow>
        </SettingsGroup>
      </div>
    </SettingsSection>
  );
}
