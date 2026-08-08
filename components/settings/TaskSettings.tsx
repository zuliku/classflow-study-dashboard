"use client";

import React from "react";
import { useAppStore } from "@/store/useAppStore";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsSelect } from "@/components/settings/SettingsControls";
import { DDL_WARNING_DAYS, TASK_PRIORITIES, TASK_STATUSES } from "@/lib/preferences";
import { getModifiedPreferenceKeys, resetPreferencePatch } from "@/lib/preferences";
import { cn } from "@/lib/utils";

const PRIORITY_LABELS: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
  urgent: "紧急",
};
const STATUS_LABELS: Record<string, string> = {
  todo: "待完成",
  doing: "进行中",
};

/** 任务偏好（immediate save：选择即更新 preferences，不弹 toast） */
export function TaskSettings({ highlightedId }: { highlightedId?: string }) {
  const preferences = useAppStore((s) => s.preferences);
  const updatePreferences = useAppStore((s) => s.updatePreferences);
  const modified = new Set(getModifiedPreferenceKeys(preferences));

  return (
    <SettingsSection
      title="任务"
      description="新建任务的默认值与临近截止提示（编辑已有任务不受影响）。"
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
            className="h-9 px-2.5 bg-[#F7F5F5] border border-line rounded-xl text-charcoal font-mono font-bold focus:outline-none focus:border-charcoal"
          />
        </SettingsRow>

        <SettingsRow
          settingId="default-task-priority"
          title="默认优先级"
          description="新建任务时预填的优先级。"
          modified={modified.has("defaultTaskPriority")}
          onReset={() => updatePreferences(resetPreferencePatch("defaultTaskPriority"))}
          resetAriaLabel="将默认优先级恢复默认"
          highlighted={highlightedId === "default-task-priority"}
        >
          <SettingsSelect
            value={preferences.defaultTaskPriority}
            onChange={(v) => updatePreferences({ defaultTaskPriority: v })}
            ariaLabel="默认优先级"
            options={TASK_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))}
          />
        </SettingsRow>

        <SettingsRow
          settingId="default-task-status"
          title="默认状态"
          description="新建任务时预填的状态（仅待完成 / 进行中）。"
          modified={modified.has("defaultTaskStatus")}
          onReset={() => updatePreferences(resetPreferencePatch("defaultTaskStatus"))}
          resetAriaLabel="将默认状态恢复默认"
          highlighted={highlightedId === "default-task-status"}
        >
          <SettingsSelect
            value={preferences.defaultTaskStatus}
            onChange={(v) => updatePreferences({ defaultTaskStatus: v })}
            ariaLabel="默认状态"
            options={TASK_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
          />
        </SettingsRow>
      </div>
    </SettingsSection>
  );
}
