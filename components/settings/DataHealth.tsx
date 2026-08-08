"use client";

import React, { useState, useEffect, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { findDataIntegrityIssues } from "@/lib/dataIntegrity";
import { checkMaterialAvailability, MaterialAvailability } from "@/lib/backupPackage";
import { cn } from "@/lib/utils";

export interface DataHealthState {
  integrity: {
    courses: boolean;
    marks: boolean;
    groupTasks: boolean;
  };
  materials: MaterialAvailability | null;
}

/** 数据状态：完整性（用户语义）+ 课程资料可用性合并；进入页面或点击「重新检查」时计算 */
export function DataHealth() {
  const { courses, schedules, assignments, calendarMarks, groupProjects } = useAppStore();
  const [health, setHealth] = useState<DataHealthState | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  const runCheck = useCallback(() => {
    setIsChecking(true);
    const issues = findDataIntegrityIssues({
      courses,
      schedules,
      assignments,
      calendarMarks,
      groupProjects,
    });
    setHealth({
      integrity: {
        courses: issues.orphanSchedules.length === 0 && issues.orphanAssignments.length === 0,
        marks:
          issues.unlinkedLegacyDDLMarks.length === 0 &&
          issues.orphanDDLMarks.length === 0,
        groupTasks: issues.orphanGroupTaskAssignments.length === 0,
      },
      materials: null,
    });
    checkMaterialAvailability(courses)
      .then((m) =>
        setHealth((prev) => (prev ? { ...prev, materials: m } : prev))
      )
      .catch(() => {})
      .finally(() => setIsChecking(false));
  }, [courses, schedules, assignments, calendarMarks, groupProjects]);

  // 进入页面检查一次（轻量；不监听每次 Store mutation）
  useEffect(() => {
    runCheck();
  }, [runCheck]);

  const integrityRows = [
    { label: "课程与课表关联", ok: health?.integrity.courses },
    { label: "任务与日历关联", ok: health?.integrity.marks },
    { label: "小组任务关联", ok: health?.integrity.groupTasks },
  ];

  const materialsTotal = health?.materials?.total ?? 0;
  const materialsAvailable = health?.materials?.available ?? 0;
  const materialsMissing = health?.materials?.missing.length ?? 0;
  const anyIssue =
    !health ||
    integrityRows.some((r) => r.ok === false) ||
    materialsMissing > 0;

  return (
    <div className="p-3 bg-[#F7F5F5] border border-line rounded-xl space-y-2 text-xs" data-testid="data-health">
      <div className="flex items-center justify-between">
        <span className={cn("flex items-center gap-1.5 font-bold", anyIssue ? "text-warning" : "text-success")}>
          <span className={cn("w-1.5 h-1.5 rounded-full", anyIssue ? "bg-warning" : "bg-success")} />
          {health && anyIssue ? "发现 1 项需要注意" : health ? "数据状态正常" : "检查中…"}
        </span>
        <button
          onClick={runCheck}
          disabled={isChecking}
          className="p-1 text-sandrift hover:bg-alba rounded-lg transition-colors disabled:opacity-50"
          title="重新检查"
          aria-label="重新检查"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? "animate-spin" : ""}`} />
        </button>
      </div>

      {health && (
        <div className="space-y-1 text-[11px]">
          {integrityRows.map((r) => (
            <div key={r.label} className="flex items-center justify-between">
              <span className="text-satin-grey">{r.label}</span>
              <span className={cn("font-semibold", r.ok ? "text-success" : "text-warning")}>
                {r.ok ? "正常" : "异常"}
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <span className="text-satin-grey">课程资料</span>
            <span className={cn("font-semibold", materialsMissing > 0 ? "text-warning" : "text-success")}>
              {materialsMissing > 0
                ? `${materialsMissing} 个文件缺失`
                : materialsTotal > 0
                ? `${materialsAvailable} / ${materialsTotal} 可用`
                : "无本地文件"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
