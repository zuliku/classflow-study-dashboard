"use client";

import React, { useEffect, useRef, useState } from "react";
import { Activity } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { AnalyticsRangePreset, LearningAnalyticsSnapshot } from "@/lib/analytics/types";
import { useLearningAnalytics } from "@/hooks/useLearningAnalytics";
import { useEffectiveReducedMotion } from "@/hooks/useEffectiveReducedMotion";
import {
  AnalyticsSummaryStrip,
  AnalyticsSummaryStripSkeleton,
} from "@/components/analytics/AnalyticsSummaryStrip";
import { AnalyticsVerdict } from "@/components/analytics/AnalyticsVerdict";
import { AnalyticsMomentum } from "@/components/analytics/AnalyticsMomentum";
import { AnalyticsCardHeader } from "@/components/analytics/AnalyticsCardHeader";
import { buildAnalyticsVerdict } from "@/lib/analytics/verdict";
import { LearningTrendChart } from "@/components/analytics/LearningTrendChart";
import { LearningSignalsCard } from "@/components/analytics/LearningSignalsCard";
import { CourseInvestmentCard } from "@/components/analytics/CourseInvestmentCard";
import { FocusRhythmCard } from "@/components/analytics/FocusRhythmCard";
import { ExecutionQualityCard } from "@/components/analytics/ExecutionQualityCard";
import { AnalyticsCoverageNotice } from "@/components/analytics/AnalyticsCoverageNotice";
import { WeeklyReviewCard } from "@/components/analytics/WeeklyReviewCard";
import { StudyOutlookCard } from "@/components/analytics/StudyOutlookCard";
import { useStudyOutlook } from "@/hooks/useStudyOutlook";
import { StudyOutlookHorizon } from "@/lib/outlook/types";
import {
  formatAnalyticsDuration,
  presentCompletedMetric,
  presentCourseInvestment,
  presentExecutionQuality,
  presentFocusMetric,
  presentOnTimeMetric,
  presentPlanExecutionMetric,
  presentPlanMetric,
} from "@/lib/analytics/presentation";
import { cn } from "@/lib/utils";
import { handleOpenOutlookAssignment } from "@/lib/analytics/outlookAssignmentAction";
import { WorkspaceHeader } from "@/components/layout/WorkspaceHeader";
import { AnalyticsWorkspaceViewBar } from "@/components/analytics/AnalyticsWorkspaceViewBar";
import { DisclosureRegion } from "@/components/ui/DisclosureRegion";

const ANALYTICS_CARD = "rounded-xl border border-line bg-surface p-4";

const ANALYTICS_TOP_GRID =
  "grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1.95fr)_minmax(0,1fr)] items-stretch";

/** 主分析行：趋势（宽） / 值得注意（窄） */
export const ANALYTICS_MAIN_GRID =
  "grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.92fr)_minmax(0,1fr)] items-stretch";

function EmptyState({ onNewTask, onPlan }: { onNewTask: () => void; onPlan: () => void }) {
  // 数据感知的进度行：store 里已有课程/任务时告诉用户差什么（均为真实计数，不编造）
  const courseCount = useAppStore((s) => s.courses.length);
  const assignmentCount = useAppStore((s) => s.assignments.length);
  const progressLine =
    assignmentCount > 0
      ? `你已有 ${assignmentCount} 个任务，完成 1 个即可开始。`
      : courseCount > 0
        ? `已建 ${courseCount} 门课程，新建任务并完成 1 个即可开始。`
        : "先添加课程与任务，完成 1 个即可开始。";
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-line bg-surface px-6 py-14 text-center md:py-16">
      <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-alabaster text-sandrift">
        <Activity className="h-5 w-5" strokeWidth={1.6} aria-hidden="true" />
      </span>
      <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-charcoal">还没有学习记录</h2>
      <p className="mt-1 max-w-[360px] text-xs leading-relaxed text-satin-grey">{progressLine}</p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={onNewTask}
          className="h-8 rounded-lg bg-charcoal px-4 text-xs font-semibold text-white transition-colors hover:bg-black"
        >
          新建任务
        </button>
        <button
          type="button"
          onClick={onPlan}
          className="h-8 rounded-lg border border-line px-4 text-xs font-semibold text-charcoal transition-colors hover:bg-alabaster"
        >
          安排学习计划
        </button>
      </div>
    </div>
  );
}

/** 学习洞察（Analytics V5）：圆角卡片分组总览；趋势、动量、信号、分布、下一步在一屏内可读。 */
export function LearningAnalyticsView() {
  const [preset, setPreset] = useState<AnalyticsRangePreset>("week");
  /** 周回顾展开状态：只属于 component UI state，不持久化 */
  const [reviewExpanded, setReviewExpanded] = useState(false);
  const reviewRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = useEffectiveReducedMotion();
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setSelectedCourseId = useAppStore((s) => s.setSelectedCourseId);
  // Workflow UX V13：Outlook task → 全局 Assignment Drawer（selective action 订阅，不切 Workspace）
  const setSelectedAssignmentId = useAppStore((s) => s.setSelectedAssignmentId);
  const courses = useAppStore((s) => s.courses);
  const { data, loading, error, refresh } = useLearningAnalytics(preset);
  const [outlookHorizon, setOutlookHorizon] = useState<StudyOutlookHorizon>(7);
  const outlook = useStudyOutlook(outlookHorizon);
  // 趋势图动画：仅首次 meaningful load 播放；后续 Range 切换直接更新（外层 ux-settle 表达 continuity）
  const [trendAnimated, setTrendAnimated] = useState(true);
  useEffect(() => {
    if (data && !data.isEmpty) setTrendAnimated(false);
  }, [data]);

  const courseNameById = Object.fromEntries(courses.map((c) => [c.id, c.name]));

  // 历史分析 stage：preset / data state 变化时轻 settle（skeleton→data、empty→data、error→data 均有连续性）
  const analyticsStageState = loading ? "loading" : error ? "error" : data ? (data.isEmpty ? "empty" : "data") : "idle";
  const analyticsStageKey = `${preset}|${analyticsStageState}`;
  // 首个数据 stage 挂载一次性阶梯（0/40/80/120/160ms）：preset 切换重挂载不再阶梯
  //（频繁切换跟手优先）；reduced-motion 下无延迟（全局时长守卫只压 duration，不压 delay）。
  // render 期懒初始化（sanctioned lazy-init；并发丢弃时最多跳过阶梯，无副作用）。
  const staggerKeyRef = useRef<string | null>(null);
  const dataStage = !!data && !loading && !error && !data.isEmpty;
  let staggerFirstData = false;
  if (dataStage && staggerKeyRef.current === null) {
    staggerKeyRef.current = analyticsStageKey;
    staggerFirstData = true;
  }
  const staggerStyle = (i: number): React.CSSProperties | undefined =>
    staggerFirstData && !reducedMotion ? { animationDelay: `${i * 40}ms` } : undefined;

  const navigate = (tab: "assignments" | "timetable" | "courses") => {
    setActiveTab(tab);
  };

  /** 下一步（学习前瞻）：独立于历史 Snapshot，空历史用户同样可见。 */
  const renderOutlookBlock = () => (
    <>
      {outlook.error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
          <p className="text-[11px] font-medium text-danger">学习前瞻加载失败</p>
          <button
            type="button"
            onClick={() => outlook.refresh()}
            className="text-[11px] font-semibold text-charcoal underline underline-offset-2 transition-colors hover:text-black"
          >
            重试
          </button>
        </div>
      ) : outlook.loading && !outlook.data ? (
        <div className="ux-skeleton h-40 w-full rounded-xl bg-alabaster animate-pulse" aria-label="学习前瞻加载中" />
      ) : outlook.data ? (
        <StudyOutlookCard
          outlook={outlook.data}
          horizonDays={outlookHorizon}
          onHorizonChange={setOutlookHorizon}
          onOpenAssignment={handleOpenOutlookAssignment}
          compact
        />
      ) : null}
    </>
  );

  /** 周回顾：toggle 语义（V3.1）——已展开且仍在 week 时收起；否则切 week + 展开 + scroll */
  const toggleWeeklyReview = () => {
    if (preset === "week" && reviewExpanded) {
      setReviewExpanded(false);
      return;
    }
    setPreset("week");
    setReviewExpanded(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        reviewRef.current?.scrollIntoView({
          behavior: reducedMotion ? "auto" : "smooth",
          block: "start",
        });
      });
    });
  };

  /** 手动切 range：周回顾必须保持 week 语义 → 收起 */
  const changePreset = (next: AnalyticsRangePreset) => {
    setPreset(next);
    setReviewExpanded(false);
  };

  /** Summary Strip 四项（V3：计划执行 = ratio；Unknown ≠ Zero 由 present* 保证） */
  const summaryMetrics = (d: LearningAnalyticsSnapshot) => {
    const c = d.coverage;
    const focusView = presentFocusMetric(d.overview.actualFocusMinutes, c.focusReliability);
    // 对比可用时保留克制 delta（只作 secondary 文案，不染色）
    if (c.comparisonAvailable && d.overview.focusDeltaPercent !== null) {
      const delta = d.overview.focusDeltaPercent;
      const deltaText = `${delta >= 0 ? "↑" : "↓"} ${Math.abs(delta)}%`;
      focusView.detail = [focusView.detail, deltaText].filter(Boolean).join(" · ");
    }
    return [
      { label: "实际专注", view: focusView },
      {
        label: "完成任务",
        view: presentCompletedMetric(d.overview.completedAssignments, c.assignmentReliability),
      },
      {
        label: "计划执行",
        view: presentPlanExecutionMetric(
          d.overview.actualFocusMinutes,
          d.overview.plannedMinutes,
          c.planReliability
        ),
      },
      {
        label: "按时完成",
        view: presentOnTimeMetric(
          d.overview.onTimeRate,
          d.overview.onTimeCount,
          d.overview.onTimeEligible,
          c.assignmentReliability
        ),
      },
    ];
  };

  const trendDays = data ? data.trend.filter((p) => p.focusMinutes !== null).length : 0;
  const dailyFocus = data && trendDays > 0 ? Math.round(data.overview.actualFocusMinutes / trendDays) : null;
  const planRatio =
    data && data.coverage.planReliability === "complete" && data.overview.plannedMinutes > 0
      ? Math.min(100, Math.round((data.overview.actualFocusMinutes / data.overview.plannedMinutes) * 100))
      : null;

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {/* App Chrome V2.3：WorkspaceHeader + AnalyticsWorkspaceViewBar（与 Body 同步拉伸，大屏充分利用宽度，保留 24–32px 安全边距）
          S4-2：sticky chrome wrapper（Header + ViewBar 同 Assignments/Timeline 一起钉住；此前 shrink-0 使顶栏随滚） */}
      <div className="sticky top-0 z-20 shrink-0" data-testid="analytics-header-inner">
        <WorkspaceHeader
          title="学习洞察"
          innerClassName="w-full max-w-none xl:px-8"
        />
        <AnalyticsWorkspaceViewBar
          preset={preset}
          onPresetChange={changePreset}
          reviewExpanded={reviewExpanded}
          onWeeklyReviewToggle={toggleWeeklyReview}
          innerClassName="w-full max-w-none xl:px-8"
        />
      </div>

      {/* S4-2：纵向滚动唯一归 main（app/page outer main scrolling）；内层不再自建滚动上下文 */}
      <div className="flex-1 min-h-0">
        <div
          data-testid="analytics-body"
          // 水平 gutter 单一来源（workspace-gutter 16/24）+ intentional xl:px-8 大屏档；
          // S4-1：gutter 已入 components 层，utilities 的 xl:px-8 自然覆盖，不再需要 !important
          className="w-full max-w-none flex flex-col gap-4 workspace-gutter py-4 pb-24 md:py-5 md:pb-6 xl:px-8 xl:py-5 xl:pb-6"
        >
          {/* 历史分析 stage（loading/error/empty/normal 同一容器；preset 变化轻 settle） */}
          <div key={analyticsStageKey} className="ux-settle flex flex-col gap-4">
          {loading ? (
            <>
              <div className={ANALYTICS_TOP_GRID}>
                <div className="rounded-xl border border-line bg-surface p-4">
                  <div className="ux-skeleton h-10 w-2/3 rounded bg-alabaster" />
                  <div className="mt-3">
                    <AnalyticsSummaryStripSkeleton />
                  </div>
                </div>
                <div className="ux-skeleton h-[250px] w-full rounded-xl border border-line-soft bg-alabaster" />
              </div>
              <div className={ANALYTICS_MAIN_GRID}>
                <div className="ux-skeleton h-[250px] w-full rounded-xl border border-line-soft bg-alabaster" />
                <div className="ux-skeleton h-[250px] w-full rounded-xl border border-line-soft bg-alabaster" />
              </div>
              <div className="ux-skeleton h-[200px] w-full rounded-xl border border-line-soft bg-alabaster" />
            </>
          ) : error ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-line bg-surface px-6 py-14 text-center">
              <p className="text-[14px] font-semibold text-charcoal">学习洞察加载失败</p>
              <p className="mt-1 text-xs text-sandrift">请稍后重试，已记录的数据不会丢失。</p>
              <button
                type="button"
                onClick={() => refresh()}
                className="mt-4 h-8 rounded-lg border border-line px-4 text-xs font-semibold text-charcoal transition-colors hover:bg-alabaster"
              >
                重试
              </button>
            </div>
          ) : data ? (
            <>
              {!data.isEmpty && (
                <AnalyticsCoverageNotice
                  facts={{
                    assignmentReliability: data.coverage.assignmentReliability,
                    planReliability: data.coverage.planReliability,
                    focusReliability: data.coverage.focusReliability,
                    focusBackfilled: data.coverage.focusBackfilled,
                    historyStartedAt: data.coverage.historyStartedAt,
                    planCoverageStartedAt: data.coverage.planCoverageStartedAt,
                  }}
                />
              )}
              {data.isEmpty ? (
                <>
                  <EmptyState onNewTask={() => navigate("assignments")} onPlan={() => navigate("timetable")} />
                  <section className={cn(ANALYTICS_CARD, "ux-settle")}>
                    <AnalyticsCardHeader title="下一步" />
                    <div className="mt-3">{renderOutlookBlock()}</div>
                  </section>
                  <DisclosureRegion open={reviewExpanded}>
                    <div ref={reviewRef} className="scroll-mt-4">
                      <WeeklyReviewCard snapshot={data} />
                    </div>
                  </DisclosureRegion>
                </>
              ) : (
                <>
                  {/* 1. 摘要与动量：结论/KPI/执行 + 独立动量大块 */}
                  <div className={ANALYTICS_TOP_GRID}>
                    <section
                      data-testid="analytics-summary-card"
                      style={staggerStyle(0)}
                      className={cn(ANALYTICS_CARD, "ux-settle flex h-full flex-col justify-center")}
                    >
                      <AnalyticsVerdict
                        verdict={buildAnalyticsVerdict({
                          signals: data.signals,
                          overview: data.overview,
                          comparisonAvailable: data.coverage.comparisonAvailable,
                        })}
                        onAction={navigate}
                      />
                      <div className="mt-3">
                        <AnalyticsSummaryStrip metrics={summaryMetrics(data)} embedded />
                      </div>
                      {/* 计划完成度只在「有已到时间的计划」时出现：无计划时 KPI 已表达，
                          不再渲染空 track + 「记录不足」这种伪进度行。 */}
                      {planRatio !== null && (
                        <div className="mt-3 border-t border-line-soft pt-2.5">
                          <div className="flex items-center justify-between text-[10.5px] text-sandrift">
                            <span>计划完成度</span>
                            <span className="tabular-nums">{planRatio}%</span>
                          </div>
                          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-alabaster">
                            <div
                              className="h-full rounded-full bg-charcoal/60 transition-[width] duration-[var(--motion-data)] ease-[var(--ease-standard)]"
                              style={{ width: `${planRatio}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </section>
                    <section
                      style={staggerStyle(0)}
                      className={cn(ANALYTICS_CARD, "ux-settle flex h-full flex-col")}
                    >
                      <div className="flex items-center justify-between gap-3 pb-2">
                        <AnalyticsCardHeader title="学习动量" />
                        <span className="text-[10.5px] text-sandrift">近 12 周</span>
                      </div>
                      <AnalyticsMomentum card />
                    </section>
                  </div>

                  <DisclosureRegion open={reviewExpanded}>
                    <div ref={reviewRef} className="scroll-mt-4">
                      <WeeklyReviewCard snapshot={data} />
                    </div>
                  </DisclosureRegion>

                  {/* 2. 主分析：趋势（宽） / 值得注意（窄） */}
                  <div className={ANALYTICS_MAIN_GRID}>
                    <section
                      style={staggerStyle(1)}
                      className={cn(ANALYTICS_CARD, "flex h-full flex-col ux-settle")}
                      data-testid="learning-trend-card"
                    >
                      <AnalyticsCardHeader title="学习趋势" />
                      <div className="flex-1 pt-2">
                        <LearningTrendChart points={data.trend} period={data.period} animate={trendAnimated} compact />
                      </div>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-2 text-[10.5px] text-sandrift">
                        <span>本周期完成 {data.overview.completedAssignments} 个任务</span>
                        <span>{dailyFocus !== null ? `日均专注 ${formatAnalyticsDuration(dailyFocus)}` : "暂无专注记录"}</span>
                      </div>
                    </section>
                    <section
                      style={staggerStyle(1)}
                      className={cn(ANALYTICS_CARD, "flex h-full flex-col ux-settle")}
                      data-testid="analytics-signals-column"
                    >
                      <div className="min-h-0 flex-1">
                        <LearningSignalsCard signals={data.signals} onNavigate={navigate} />
                      </div>
                      <div className="mt-3 border-t border-line-soft pt-2.5">
                        <ExecutionQualityCard
                          inline
                          view={presentExecutionQuality(
                            data.execution,
                            data.coverage.assignmentReliability,
                            data.coverage.focusReliability
                          )}
                        />
                      </div>
                    </section>
                  </div>

                  {/* 3. 分布与下一步：一个圆角块，内部左右分栏 */}
                  <section style={staggerStyle(2)} className={cn(ANALYTICS_CARD, "ux-settle")}>
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] xl:divide-x xl:divide-line-soft">
                      <div className="min-w-0">
                        <AnalyticsCardHeader title="投入与节奏" />
                        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <CourseInvestmentCard
                            investment={presentCourseInvestment(data.courseInvestment, courseNameById)}
                            onOpenCourse={(courseId) => {
                              if (courseNameById[courseId]) setSelectedCourseId(courseId);
                            }}
                            nested
                          />
                          <div className="min-w-0 sm:border-l sm:border-line-soft sm:pl-4">
                            <FocusRhythmCard rhythm={data.focusRhythm} nested />
                          </div>
                        </div>
                      </div>
                      <div className="flex min-w-0 flex-col border-t border-line-soft pt-4 xl:border-t-0 xl:pl-4 xl:pt-0">
                        <AnalyticsCardHeader title="下一步" />
                        <div className="mt-3">{renderOutlookBlock()}</div>
                      </div>
                    </div>
                  </section>
                </>
              )}
            </>
          ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
