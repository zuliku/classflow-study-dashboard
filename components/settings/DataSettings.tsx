"use client";

import React, { useState, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsGroup } from "@/components/settings/SettingsGroup";
import { SettingsActionRow } from "@/components/settings/SettingsActionRow";
import { DataOverview } from "@/components/settings/DataOverview";
import { DataHealth } from "@/components/settings/DataHealth";
import { BackupSection } from "@/components/settings/BackupSection";
import { RestoreSection, RestoreResult } from "@/components/settings/RestoreSection";
import { DangerZone } from "@/components/settings/DangerZone";
import { LearningHistorySettings } from "@/components/settings/LearningHistorySettings";
import { CheckCircle2, AlertTriangle, RefreshCcw } from "lucide-react";

/** 数据与存储中心：本地数据 / 数据状态 / 备份 / 恢复 / 危险操作 */
export function DataSettings() {
  // 选择性订阅：只有业务数据变化才重渲染（不订阅 Modal/activeTab 等 UI 状态）
  const { courses, schedules, assignments, groupProjects } = useAppStore(
    useShallow((s) => ({
      courses: s.courses,
      schedules: s.schedules,
      assignments: s.assignments,
      groupProjects: s.groupProjects,
    }))
  );

  const counts = useMemo(
    () => ({
      courses: courses.length,
      schedules: schedules.length,
      assignments: assignments.length,
      groupProjects: groupProjects.length,
      materials: courses.reduce((sum, c) => sum + c.materials.length, 0),
    }),
    [courses, schedules, assignments, groupProjects]
  );

  // 恢复结果：留在 Data & Storage 区内，不制造页面顶部大 Alert
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);

  // Dev Only：重新载入全模块演示数据（解决旧版预览数据残留，无需 ?preview= URL）
  const reloadDemoData = () => {
    if (
      !confirm(
        "重新载入完整演示数据？\n\n将覆盖当前全部任务/课程/学习计划数据（个人资料与偏好保留）。"
      )
    ) {
      return;
    }
    import("@/lib/dev/fullDemoData").then(({ buildFullDemoData }) => {
      useAppStore.getState().restoreAppData(buildFullDemoData());
      localStorage.setItem("classflow-demo-injected", "1");
      useToastStore.getState().pushToast({ message: "已重新载入完整演示数据", type: "success" });
    });
  };

  return (
    <SettingsSection title="数据与存储" description="本地数据概览、健康检查与备份管理。">
      <div className="space-y-4" data-testid="settings-data">
        {/* 数据概览：紧凑 metric（非 Dashboard 大 Stat Card） */}
        <SettingsGroup title="数据概览">
          <div className="py-3">
            <DataOverview counts={counts} />
          </div>
        </SettingsGroup>

        {/* 数据状态：完整性检查（信息性质，非设置） */}
        <SettingsGroup title="数据状态">
          <div className="py-3">
            <DataHealth />
          </div>
        </SettingsGroup>

        {/* 学习历史（Part 2）：startedAt + 事件数 + 清除；无 Event Viewer */}
        <SettingsGroup title="学习历史">
          <LearningHistorySettings />
        </SettingsGroup>

        {/* 恢复结果反馈（留在本区，不制造页面顶部大 Alert） */}
        {restoreResult && (
          <div className="p-3 bg-pastel-mint/60 border border-line rounded-xl space-y-0.5 text-xs" data-testid="restore-result">
            <p className="flex items-center gap-1.5 font-bold text-success">
              <CheckCircle2 className="w-3.5 h-3.5" />
              恢复完成
            </p>
            <p className="text-[11px] text-satin-grey">
              {restoreResult.courses} 门课程 · {restoreResult.schedules} 个排课时段 ·{" "}
              {restoreResult.assignments} 项任务 · {restoreResult.materials} 个附件
            </p>
            {restoreResult.warnings.map((w) => (
              <p key={w} className="flex items-start gap-1.5 text-warning font-semibold text-[11px]">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                {w}
              </p>
            ))}
          </div>
        )}

        {/* 备份 / 恢复 / 危险操作：统一 SettingsActionRow 布局 */}
        <SettingsGroup title="备份">
          <BackupSection />
        </SettingsGroup>

        <SettingsGroup title="恢复">
          <RestoreSection onRestored={setRestoreResult} />
        </SettingsGroup>

        <SettingsGroup title="危险操作">
          <DangerZone />
        </SettingsGroup>

        {/* 开发工具（仅 dev）：低权重，位于页面最底部，不属于正式设置 */}
        {process.env.NODE_ENV === "development" && (
          <SettingsGroup title="开发工具">
            <SettingsActionRow
              title="完整演示数据"
              description="重载用于本地开发的完整模块数据（覆盖业务数据，保留个人资料与偏好）"
              icon={<RefreshCcw className="w-3.5 h-3.5 text-[#A48F82]" />}
              actionLabel="重新载入"
              onAction={reloadDemoData}
              actionMinWidth="min-w-[104px]"
            />
          </SettingsGroup>
        )}
      </div>
    </SettingsSection>
  );
}
