"use client";

import React from "react";
import { useAppStore } from "@/store/useAppStore";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { DDL_WARNING_DAYS } from "@/lib/preferences";
import { getModifiedPreferenceKeys, resetPreferencePatch } from "@/lib/preferences";
import { cn } from "@/lib/utils";

/** 任务偏好（immediate save：选择即更新 preferences，不弹 toast） */
export function TaskSettings({ highlightedId }: { highlightedId?: string }) {
  const preferences = useAppStore((s) => s.preferences);
  const updatePreferences = useAppStore((s) => s.updatePreferences);
  const modified = new Set(getModifiedPreferenceKeys(preferences));

  return (
    <SettingsSection
      title="任务"
      description="用于总览与任务列表的临近截止提示。"
    >
      <div className="text-xs" data-testid="settings-tasks">
        <SettingsRow
          settingId="ddl-warning-days"
          title="临近截止提醒"
          description="未来多少天内显示截止任务。"
          modified={modified.has("ddlWarningDays")}
          onReset={() => updatePreferences(resetPreferencePatch("ddlWarningDays"))}
          resetAriaLabel="将临近截止提醒恢复默认"
          highlighted={highlightedId === "ddl-warning-days"}
        >
          <div className="flex items-center gap-1 bg-alabaster p-0.5 rounded-xl border border-line-strong">
            {DDL_WARNING_DAYS.map((d) => {
              const isActive = preferences.ddlWarningDays === d;
              return (
                <button
                  key={d}
                  onClick={() => updatePreferences({ ddlWarningDays: d })}
                  aria-pressed={isActive}
                  className={cn(
                    "px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors duration-[var(--motion-fast)]",
                    isActive
                      ? "bg-white text-charcoal shadow-subtle"
                      : "text-satin-grey hover:text-charcoal"
                  )}
                >
                  {d} 天
                </button>
              );
            })}
          </div>
        </SettingsRow>

        <SettingsRow
          settingId="default-ddl-time"
          title="默认截止时间"
          description="新建任务时预填的截止时刻（HH:mm）；编辑已有任务不受影响。"
          modified={modified.has("defaultDDLTime")}
          onReset={() => updatePreferences(resetPreferencePatch("defaultDDLTime"))}
          resetAriaLabel="将默认截止时间恢复默认"
          highlighted={highlightedId === "default-ddl-time"}
        >
          <input
            type="time"
            value={preferences.defaultDDLTime}
            onChange={(e) => updatePreferences({ defaultDDLTime: e.target.value })}
            className="px-2.5 py-1.5 bg-[#F7F5F5] border border-line rounded-xl text-charcoal font-mono font-bold focus:outline-none"
          />
        </SettingsRow>
      </div>
    </SettingsSection>
  );
}
