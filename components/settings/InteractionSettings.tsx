"use client";

import React from "react";
import { useAppStore } from "@/store/useAppStore";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { MOTION_PREFERENCES } from "@/lib/preferences";
import { cn } from "@/lib/utils";

/** 设置行：标题 + 描述 + 右侧控件 */
function SettingsRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-3 border-b border-line-soft last:border-b-0">
      <div className="min-w-0">
        <h4 className="text-xs font-bold text-charcoal">{title}</h4>
        <p className="text-[10px] text-sandrift mt-0.5">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

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

/** 交互与外观偏好（immediate save：开关即更新 preferences） */
export function InteractionSettings() {
  const preferences = useAppStore((s) => s.preferences);
  const updatePreferences = useAppStore((s) => s.updatePreferences);

  return (
    <SettingsSection
      title="交互与外观"
      description="课表显示与直接操作的启用状态（对应业务模块将在后续版本接入）。"
    >
      <div className="text-xs" data-testid="settings-interaction">
        <SettingsRow title="显示周末" description="在课表中显示周六与周日。">
          <Toggle
            checked={preferences.showWeekends}
            onChange={(v) => updatePreferences({ showWeekends: v })}
            label="显示周末"
          />
        </SettingsRow>

        <SettingsRow
          title="课表直接操作"
          description="在完整课表中启用拖动调整与缩放排课。"
        >
          <Toggle
            checked={preferences.enableScheduleDirectManipulation}
            onChange={(v) => updatePreferences({ enableScheduleDirectManipulation: v })}
            label="课表直接操作"
          />
        </SettingsRow>

        <SettingsRow
          title="DDL 直接操作"
          description="在日历中启用拖动调整截止日期。"
        >
          <Toggle
            checked={preferences.enableDDLDirectManipulation}
            onChange={(v) => updatePreferences({ enableDDLDirectManipulation: v })}
            label="DDL 直接操作"
          />
        </SettingsRow>

        <SettingsRow title="动效偏好" description="界面动画强度；跟随系统时尊重系统减弱动效设置。">
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
