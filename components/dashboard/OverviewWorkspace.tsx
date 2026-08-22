"use client";

import React from "react";
import { FileUp, Plus, CalendarDays } from "lucide-react";
import { WorkspaceHeader } from "@/components/layout/WorkspaceHeader";
import { TimetableGrid } from "@/components/dashboard/TimetableGrid";
import {
  buildOverviewStudyBlockLayers,
  buildOverviewCourseTaskMarkers,
} from "@/components/dashboard/overviewStudyBlockLayers";
import { TimetableQuickGlance } from "@/components/dashboard/TimetableQuickGlance";
import { UpcomingDDL } from "@/components/dashboard/UpcomingDDL";
import { MiniCalendar } from "@/components/dashboard/MiniCalendar";
import { StudyLoadChart } from "@/components/dashboard/StudyLoadChart";
import { AssignmentTable } from "@/components/dashboard/AssignmentTable";
import { useAppStore } from "@/store/useAppStore";
import { formatWeekDateRange } from "@/lib/semester";

/**
 * Overview Workspace：总览页（首屏 Hero 三卡 + fold 以下第二屏）。
 *
 * 从 app/page.tsx 原样迁移的纯代码组织重构：布局、store 语义、First Run 行为、
 * fold geometry 与 responsive 降级完全一致。信息架构契约：
 * - 左 2/3 本周课表；右 1/3 = 临近 DDL（flex-1）+ Mini Calendar（固定高度）上下布局
 * - 首屏 viewport-bounded hero（xl:h-[calc(...)]），三卡同顶同底
 * - 第二屏 = 本周课程负荷 + 任务清单，滚动后出现
 * - 页面 body 水平 gutter 使用 workspace-gutter（与 WorkspaceHeader 精确对齐）
 */
export function OverviewWorkspace() {
  // 精确 selector：避免整 store 订阅导致无关 state 更新触发全量 render
  const courses = useAppStore((s) => s.courses);
  const assignments = useAppStore((s) => s.assignments);
  const semester = useAppStore((s) => s.semester);
  const currentSemesterWeek = useAppStore((s) => s.currentSemesterWeek);
  const schedules = useAppStore((s) => s.schedules);
  const studyBlocks = useAppStore((s) => s.studyBlocks);
  const setAddCourseModalOpen = useAppStore((s) => s.setAddCourseModalOpen);
  const setImportScheduleModalOpen = useAppStore((s) => s.setImportScheduleModalOpen);
  const setSettingsModalOpen = useAppStore((s) => s.setSettingsModalOpen);

  // 当前周 Context（Overview / Timeline / Analytics 共用同一学期模型数据源）
  const currentWeekContext = `第 ${currentSemesterWeek} 周 · ${formatWeekDateRange(
    semester,
    currentSemesterWeek
  )}`;

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <WorkspaceHeader title="总览" context={currentWeekContext} sticky />
      {/* First Run：空工作区时显示 Getting Started（非阻塞，三个动作即可开始） */}
      {courses.length === 0 && schedules.length === 0 && assignments.length === 0 ? (
        <div className="workspace-gutter flex flex-1 min-h-0 flex-col pt-4 pb-24 md:pt-6 md:pb-6">
          <div
            data-testid="getting-started"
            className="dashboard-card p-6 space-y-4 text-center"
          >
            <div>
              <h2 className="text-lg font-bold text-charcoal">欢迎使用 ClassFlow</h2>
              <p className="text-xs text-sandrift mt-1">建立你的学习工作区</p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              <button
                onClick={() => setImportScheduleModalOpen(true)}
                className="ux-press flex items-center gap-1.5 h-9 px-4 bg-charcoal hover:bg-black text-white text-xs font-bold rounded-lg transition-colors shadow-subtle"
              >
                <FileUp className="w-3.5 h-3.5" />
                导入课表
              </button>
              <button
                onClick={() => setAddCourseModalOpen(true)}
                className="ux-press flex items-center gap-1.5 h-9 px-4 bg-pastel-mint hover:bg-pastel-mint text-charcoal text-xs font-bold rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                添加第一门课程
              </button>
              <button
                onClick={() => setSettingsModalOpen(true)}
                className="ux-press flex items-center gap-1.5 h-9 px-4 bg-transparent border border-line text-satin-grey text-xs font-bold rounded-lg transition-colors hover:bg-alabaster hover:text-charcoal"
              >
                <CalendarDays className="w-3.5 h-3.5 text-sandrift" />
                设置当前学期
              </button>
            </div>
            <p className="text-[11px] text-sandrift">
              也可以直接新建任务或浏览课表，随时可以从设置中调整
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Overview Hero Section — viewport bounded accounting for TitleBar + Header + fold gap。
              水平 gutter 走 workspace-gutter（16 → 24px），垂直 rhythm 保持原有 pt/pb 不变，
              fold geometry（xl 固定高度 + fold-gap margin）不受影响。 */}
          <section className="box-border flex flex-col shrink-0 min-h-0 workspace-gutter pt-4 pb-24 md:pt-5 md:pb-5 xl:h-[calc(100dvh-var(--titlebar-h)-4rem-var(--overview-fold-gap))] xl:mb-[var(--overview-fold-gap)] xl:pb-0 [@media(max-height:720px)]:!pt-2 [@media(max-height:720px)]:!pb-0">
            {/* 三卡 Grid：flex-1 eats remaining hero space, three cards same top/bottom */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch flex-1 min-h-0">
              <div className="lg:col-span-2 flex flex-col min-h-0">
                <TimetableGrid
                  density="compact"
                  fillAvailableHeight
                  headerActions={<TimetableQuickGlance />}
                  extraLayers={buildOverviewStudyBlockLayers({
                    studyBlocks,
                    semester,
                    currentSemesterWeek,
                    schedules,
                  })}
                  courseIndicators={buildOverviewCourseTaskMarkers({
                    studyBlocks,
                    semester,
                    currentSemesterWeek,
                  })}
                />
              </div>
              {/* 右栏：DDL 吸收剩余高度（flex-1），Calendar 固定稳定高度（不随月份/内容变化）
                  右栏总高恒等于左侧课表 → 三卡同顶同底
                  高度受限（≤800px 视口）：Agenda 隐藏 + Calendar shell 缩短，空间让给 DDL */}
              <div className="flex flex-col h-full min-h-0 gap-4">
                <div className="flex-1 min-h-0">
                  <UpcomingDDL />
                </div>
                <div className="h-[370px] lg:h-[380px] xl:h-[400px] 2xl:h-[410px] shrink-0 [@media(max-height:800px)]:h-[305px]">
                  <MiniCalendar />
                </div>
              </div>
            </div>
          </section>

          {/* Overview Secondary Section：完全位于首屏 fold 以下，滚动后才可见 */}
          <section className="grid gap-4 items-stretch shrink-0 grid-cols-[repeat(auto-fit,minmax(520px,1fr))] workspace-gutter pb-24 md:pb-5">
            <div className="md:min-h-[460px]" data-testid="overview-load-wrap">
              <StudyLoadChart />
            </div>
            <div className="md:min-h-[460px] min-w-0" data-testid="overview-tasks-wrap">
              <AssignmentTable mode="compact" />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
