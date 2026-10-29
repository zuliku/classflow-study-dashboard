"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { RefreshCw } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/store/useAppStore";
import { findDataIntegrityIssues } from "@/lib/dataIntegrity";
import { checkMaterialAvailability, MaterialAvailability } from "@/lib/backupPackage";
import { artifactDbStats } from "@/lib/ai/computer/artifacts/db";
import { cn } from "@/lib/utils";

export interface DataHealthStorage {
  indexedDbAvailable: boolean;
  usageBytes: number | null;
  quotaBytes: number | null;
  /** Kiro Artifact registry 记录数；不可用 = null（不能显示成 0） */
  artifactCount: number | null;
}

export interface DataHealthState {
  integrity: {
    courses: boolean;
    marks: boolean;
    groupTasks: boolean;
  };
  materials: MaterialAvailability | null;
  storage: DataHealthStorage | null;
  /** 检查本身失败（IndexedDB 不可用 / 异常）——绝不能显示为「数据状态正常」 */
  checkFailed?: boolean;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "未知";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/** 存储诊断：容量估算 + Artifact IndexedDB 可读性与记录数（只 count，不读内容） */
async function readStorageDiagnostics(): Promise<DataHealthStorage> {
  const indexedDbAvailable = typeof indexedDB !== "undefined";
  let usageBytes: number | null = null;
  let quotaBytes: number | null = null;
  try {
    if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      usageBytes = typeof estimate.usage === "number" ? estimate.usage : null;
      quotaBytes = typeof estimate.quota === "number" ? estimate.quota : null;
    }
  } catch {
    /* 浏览器不支持/拒绝估算：显示未知，不影响其它诊断 */
  }

  let artifactCount: number | null = null;
  if (indexedDbAvailable) {
    try {
      const stats = await artifactDbStats();
      artifactCount = stats?.artifacts ?? null;
    } catch {
      artifactCount = null;
    }
  }
  return { indexedDbAvailable, usageBytes, quotaBytes, artifactCount };
}

/** 数据状态：完整性（用户语义）+ 课程资料可用性合并；进入页面或点击「重新检查」时计算 */
export function DataHealth() {
  const { courses, schedules, assignments, calendarMarks, groupProjects } = useAppStore(
    // P2 性能：只订阅完整性检查所需数据，避免设置页随无关状态反复计算
    useShallow((s) => ({
      courses: s.courses,
      schedules: s.schedules,
      assignments: s.assignments,
      calendarMarks: s.calendarMarks,
      groupProjects: s.groupProjects,
    }))
  );
  const [health, setHealth] = useState<DataHealthState | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  /** 诊断世代：Store 连续变化时只允许最后一次异步结果落盘 */
  const checkSeq = useRef(0);

  const runCheck = useCallback(() => {
    const seq = ++checkSeq.current;
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
      storage: null,
    });

    void (async () => {
      const [materialsResult, storageResult] = await Promise.allSettled([
        checkMaterialAvailability(courses),
        readStorageDiagnostics(),
      ]);
      if (seq !== checkSeq.current) return; // 已有更新的检查：丢弃过期结果
      setHealth((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          materials:
            materialsResult.status === "fulfilled" ? materialsResult.value : prev.materials,
          // 检查失败必须可见：静默吞掉会让诊断面板在存储层故障时仍报「数据状态正常」
          checkFailed:
            prev.checkFailed === true || materialsResult.status === "rejected",
          storage:
            storageResult.status === "fulfilled" ? storageResult.value : prev.storage,
        };
      });
      setIsChecking(false);
    })();
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
  const checkFailed = health?.checkFailed === true;
  const storageUnavailable = Boolean(
    health?.storage &&
      (!health.storage.indexedDbAvailable || health.storage.artifactCount === null)
  );
  const storageUsageLabel = health?.storage
    ? health.storage.usageBytes === null
      ? "未知"
      : `${formatBytes(health.storage.usageBytes)}${
          health.storage.quotaBytes !== null
            ? ` / ${formatBytes(health.storage.quotaBytes)}`
            : ""
        }`
    : "检查中…";
  const issueCount =
    (health?.integrity.courses === false ? 1 : 0) +
    (health?.integrity.marks === false ? 1 : 0) +
    (health?.integrity.groupTasks === false ? 1 : 0) +
    (materialsMissing > 0 ? 1 : 0) +
    (checkFailed ? 1 : 0) +
    (storageUnavailable ? 1 : 0);
  const anyIssue = !health || issueCount > 0;

  return (
    <div className="p-3 bg-surface-soft border border-line rounded-xl space-y-2 text-xs" data-testid="data-health">
      <div className="flex items-center justify-between">
        <span className={cn("flex items-center gap-1.5 font-bold", anyIssue ? "text-warning" : "text-success")}>
          <span className={cn("w-1.5 h-1.5 rounded-full", anyIssue ? "bg-warning" : "bg-success")} />
          {health
            ? checkFailed && issueCount === 1
              ? "资料检查失败，请重试"
              : issueCount === 0
                ? "数据状态正常"
                : issueCount === 1
                  ? "发现 1 项需要处理"
                  : `发现 ${issueCount} 项需要处理`
            : "检查中…"}
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
          <div className="flex items-center justify-between">
            <span className="text-satin-grey">本地存储</span>
            <span
              className={cn(
                "font-semibold",
                !health.storage
                  ? "text-sandrift"
                  : health.storage.indexedDbAvailable
                    ? "text-success"
                    : "text-warning"
              )}
            >
              {!health.storage
                ? "检查中…"
                : health.storage.indexedDbAvailable
                  ? "IndexedDB 可用"
                  : "IndexedDB 不可用"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-satin-grey">存储用量</span>
            <span className="font-semibold text-charcoal tabular-nums">{storageUsageLabel}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-satin-grey">Kiro 产物索引</span>
            <span
              className={cn(
                "font-semibold",
                !health.storage
                  ? "text-sandrift"
                  : health.storage.artifactCount !== null
                    ? "text-success"
                    : "text-warning"
              )}
            >
              {!health.storage
                ? "检查中…"
                : health.storage.artifactCount !== null
                  ? `${health.storage.artifactCount} 条记录`
                  : "不可用"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
