"use client";

import React, { useEffect, useRef } from "react";
import { AlertTriangle, BookOpen, MoreHorizontal } from "lucide-react";
import { WorkspaceViewBar } from "@/components/layout/WorkspaceViewBar";
import { UISelect } from "@/components/ui/Select";
import { DropdownMenuPanel } from "@/components/ui/DropdownMenu";
import { SearchField } from "@/components/ui/SearchField";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ASSIGNMENT_VIEWBAR_VIEWS, AssignmentWorkspaceController } from "@/hooks/useAssignmentWorkspaceController";
import { useAppStore } from "@/store/useAppStore";

/**
 * Assignment Workspace View Bar（App Chrome V2）：
 * 承接原 AssignmentTable 卡片内的 workspace 控制层（视图 Tabs / Course Filter / Risk /
 * Search / More → 已归档），迁移到 WorkspaceHeader 之后的结构层。
 * 业务事实来源仍为 PRIMARY_TASK_WORKSPACE_VIEWS / TASK_WORKSPACE_VIEWS。
 */
export function AssignmentWorkspaceViewBar({ controller }: { controller: AssignmentWorkspaceController }) {
  const {
    view,
    setView,
    courseFilter,
    setCourseFilter,
    searchQuery,
    setSearchQuery,
    riskOnly,
    setRiskOnly,
    moreOpen,
    setMoreOpen,
    counts,
    atRiskCount,
  } = controller;

  const assignments = useAppStore((s) => s.assignments);
  const courses = useAppStore((s) => s.courses);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);

  // More 菜单：outside click / Esc 关闭（非 modal，不拦截页面交互）
  useEffect(() => {
    if (!moreOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!moreMenuRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  const primary = (
    <>
      {view === "archive" ? (
        /* Archive：临时状态入口（不新增永久 Tab） */
        <div className="flex items-center gap-1 bg-alabaster p-0.5 rounded-xl border border-line-strong text-[11px] font-medium">
          <span className="flex items-center gap-1 px-2.5 py-0.5 font-bold text-charcoal">
            已归档 {counts.archive}
          </span>
          <button
            onClick={() => setView("all")}
            className="px-2.5 py-0.5 rounded-lg text-satin-grey hover:text-charcoal hover:bg-white transition-colors"
          >
            ← 返回全部
          </button>
        </div>
      ) : (
        /* View Control Cluster：Segmented 拥有剩余空间；More 恒 shrink-0 */
        <div className="flex items-stretch gap-1.5 min-w-0 max-w-full">
          <SegmentedControl
            value={view}
            onChange={setView}
            ariaLabel="任务视图"
            className="flex-1 min-w-0 overflow-x-auto scrollbar-none"
            options={ASSIGNMENT_VIEWBAR_VIEWS.map((v) => ({
              value: v.id,
              label: (
                <span className="flex items-center gap-1">
                  {v.label}
                  <span className="text-[10px] font-bold text-sandrift/80">{counts[v.id]}</span>
                </span>
              ),
            }))}
          />
          <div className="relative self-stretch flex shrink-0" ref={moreMenuRef}>
            <button
              onClick={() => setMoreOpen(!moreOpen)}
              aria-label="更多视图"
              aria-expanded={moreOpen}
              className="m-auto w-8 h-8 flex items-center justify-center rounded-lg bg-alabaster border border-line-strong text-satin-grey hover:text-charcoal hover:bg-white transition-colors"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            <DropdownMenuPanel open={moreOpen} placement="bottom-end" aria-label="更多视图" className="w-40 p-1">
              <button
                onClick={() => {
                  setView("archive");
                  setMoreOpen(false);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left font-semibold text-charcoal hover:bg-alabaster transition-colors"
              >
                查看已归档
                <span className="ml-auto text-[10px] font-bold text-sandrift">{counts.archive}</span>
              </button>
            </DropdownMenuPanel>
          </div>
        </div>
      )}
    </>
  );

  const secondary = (
    <>
      {/* Course Filter：BookOpen + UISelect 外层 control group（仅 semantic token 等价迁移，不改筛选） */}
      <div className="flex items-center space-x-1.5 bg-background border border-line rounded-lg h-9 px-2.5 shrink-0">
        <BookOpen className="w-3.5 h-3.5 text-sandrift" />
        <UISelect
          value={courseFilter}
          onChange={setCourseFilter}
          ariaLabel="课程筛选"
          options={[
            { value: "all", label: `全部课程 (${assignments.length})` },
            ...courses.map((c) => ({ value: c.id, label: c.name })),
          ]}
          triggerClassName="bg-transparent border-0 h-7 px-1 min-w-[120px] text-xs font-semibold max-w-[160px]"
          itemClassName="h-8"
        />
      </div>

      {/* Part B：Focus 内轻量 Risk Filter（有风险时显示；不新增第六个 Tab） */}
      {view === "focus" && atRiskCount > 0 && (
        <button
          onClick={() => setRiskOnly(!riskOnly)}
          data-testid="focus-risk-filter"
          aria-pressed={riskOnly}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-xl border text-[11px] font-semibold transition-colors ${
            riskOnly
              ? "bg-danger-bg border-danger-border text-danger font-bold"
              : "bg-background border-line text-satin-grey hover:text-charcoal"
          }`}
        >
          <AlertTriangle className="w-3 h-3" />
          有风险 {atRiskCount}
        </button>
      )}

      {/* Search → 全局 SearchField（筛选语义不变） */}
      <SearchField
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="搜索任务…"
        aria-label="搜索任务"
        className="min-w-[150px]"
      />
    </>
  );

  return (
    <WorkspaceViewBar
      primary={primary}
      secondary={secondary}
      testid="assignment-viewbar"
    />
  );
}
