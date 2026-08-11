"use client";

import React, { useState, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsGroup } from "@/components/settings/SettingsGroup";
import { DataOverview } from "@/components/settings/DataOverview";
import { DataHealth } from "@/components/settings/DataHealth";
import { BackupSection } from "@/components/settings/BackupSection";
import { RestoreSection, RestoreResult } from "@/components/settings/RestoreSection";
import { DangerZone } from "@/components/settings/DangerZone";
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

          {/* Dev Only：演示数据重载入口（生产构建不渲染） */}
          {process.env.NODE_ENV === "development" && (
            <div
              data-testid="dev-demo-reload"
              className="flex items-center justify-between gap-3 p-3 bg-alabaster/60 border border-dashed border-line-strong rounded-xl text-xs"
            >
              <div className="min-w-0">
                <p className="font-bold text-charcoal">完整演示数据（开发模式）</p>
                <p className="text-[11px] text-sandrift">
                  重载全模块预览：总览 / 时间表 / 任务 V2 / 课程资料 / 学习统计 / 小组协作
                </p>
              </div>
              <button
                onClick={reloadDemoData}
                className="ux-press flex items-center gap-1.5 px-3 py-1.5 bg-charcoal hover:bg-black text-white text-xs font-bold rounded-lg transition-colors shrink-0"
              >
                <RefreshCcw className="w-3.5 h-3.5" />
                重新载入
              </button>
            </div>
          )}
        </SettingsGroup>

        {/* 数据状态：完整性检查（信息性质，非设置） */}
        <SettingsGroup title="数据状态">
          <div className="py-3">
            <DataHealth />
          </div>
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
      </div>
    </SettingsSection>
  );
}
