"use client";

import React, { useState, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/store/useAppStore";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { DataOverview } from "@/components/settings/DataOverview";
import { DataHealth } from "@/components/settings/DataHealth";
import { BackupSection } from "@/components/settings/BackupSection";
import { RestoreSection, RestoreResult } from "@/components/settings/RestoreSection";
import { DangerZone } from "@/components/settings/DangerZone";
import { CheckCircle2, AlertTriangle } from "lucide-react";

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

  return (
    <SettingsSection title="数据与存储" description="本地数据概览、健康检查与备份管理。">
      <div className="space-y-5" data-testid="settings-data">
        {/* 本地数据 */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold text-sandrift uppercase tracking-wider">本地数据</p>
          <DataOverview counts={counts} />
        </div>

        {/* 数据状态 */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold text-sandrift uppercase tracking-wider">数据状态</p>
          <DataHealth />
        </div>

        {/* 恢复结果反馈 */}
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

        {/* 备份 */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold text-sandrift uppercase tracking-wider">备份</p>
          <BackupSection />
        </div>

        {/* 恢复 */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold text-sandrift uppercase tracking-wider">恢复</p>
          <RestoreSection onRestored={setRestoreResult} />
        </div>

        {/* 危险操作 */}
        <div className="space-y-2 pt-1 border-t border-line-soft">
          <p className="text-[10px] font-bold text-sandrift uppercase tracking-wider">危险操作</p>
          <DangerZone />
        </div>
      </div>
    </SettingsSection>
  );
}
