"use client";

import React from "react";
import { useAppStore } from "@/store/useAppStore";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { MOTION_PREFERENCES, getModifiedPreferenceKeys, resetPreferencePatch } from "@/lib/preferences";
import { cn } from "@/lib/utils";

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative w-9 h-5 rounded-full transition-colors duration-[var(--motion-fast)]",
        checked ? "bg-charcoal" : "bg-alba"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-subtle transition-transform duration-[var(--motion-fast)]",
          checked && "translate-x-4"
        )}
      />
    </button>
  );
}

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
          <Toggle
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
          <Toggle
            checked={preferences.enableDDLDirectManipulation}
            onChange={(v) => updatePreferences({ enableDDLDirectManipulation: v })}
            label="DDL 直接操作"
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
          <select
            value={preferences.motionPreference}
            onChange={(e) =>
              updatePreferences({
                motionPreference: e.target.value as "system" | "full" | "reduced",
              })
            }
            className="px-2.5 py-1.5 bg-[#F7F5F5] border border-line rounded-xl text-charcoal font-bold focus:outline-none cursor-pointer"
          >
            {MOTION_PREFERENCES.map((m) => (
              <option key={m} value={m}>
                {m === "system" ? "跟随系统" : m === "full" ? "完整动效" : "减少动效"}
              </option>
            ))}
          </select>
        </SettingsRow>
      </div>
    </SettingsSection>
  );
}
