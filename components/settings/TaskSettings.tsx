"use client";

import React from "react";
import { useAppStore } from "@/store/useAppStore";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { DDL_WARNING_DAYS } from "@/lib/preferences";
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

/** 任务与提醒偏好（immediate save：选择即更新 preferences，不弹 toast） */
export function TaskSettings() {
  const preferences = useAppStore((s) => s.preferences);
  const updatePreferences = useAppStore((s) => s.updatePreferences);

  return (
    <SettingsSection
      title="任务与提醒"
      description="用于总览与任务列表的临近截止提示。"
    >
      <div className="text-xs" data-testid="settings-tasks">
        <SettingsRow
          title="临近截止提醒"
          description="在总览「临近 DDL」中展示未来多少天内的截止任务。"
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
          title="默认截止时间"
          description="新建任务时预填的截止时刻（HH:mm）；编辑已有任务不受影响。"
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
