"use client";

import React from "react";
import { useAppStore } from "@/store/useAppStore";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { DDL_WARNING_DAYS } from "@/lib/preferences";

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

/** 任务与提醒偏好（immediate save：选择即更新 preferences） */
export function TaskSettings() {
  const preferences = useAppStore((s) => s.preferences);
  const updatePreferences = useAppStore((s) => s.updatePreferences);

  return (
    <SettingsSection
      title="任务与提醒"
      description="临近 DDL 的提醒窗口与新建任务的默认截止时间。"
    >
      <div className="text-xs" data-testid="settings-tasks">
        <SettingsRow
          title="DDL 提醒窗口"
          description="临近截止的任务在列表与日历中高亮的天数范围。"
        >
          <select
            value={preferences.ddlWarningDays}
            onChange={(e) =>
              updatePreferences({ ddlWarningDays: Number(e.target.value) as 1 | 3 | 7 })
            }
            className="px-2.5 py-1.5 bg-[#F7F5F5] border border-line rounded-xl text-charcoal font-bold focus:outline-none cursor-pointer"
          >
            {DDL_WARNING_DAYS.map((d) => (
              <option key={d} value={d}>
                {d} 天内
              </option>
            ))}
          </select>
        </SettingsRow>

        <SettingsRow
          title="默认截止时间"
          description="新建任务时预填的截止时刻（HH:mm）。"
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
