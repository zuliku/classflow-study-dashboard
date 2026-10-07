"use client";

import React, { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { AnalyticsRangePreset, LearningAnalyticsSnapshot } from "@/lib/analytics/types";
import { useLearningAnalytics } from "@/hooks/useLearningAnalytics";
import { useEffectiveReducedMotion } from "@/hooks/useEffectiveReducedMotion";
import {
  AnalyticsSummaryStrip,
  AnalyticsSummaryStripSkeleton,
} from "@/components/analytics/AnalyticsSummaryStrip";
import { AnalyticsVerdict } from "@/components/analytics/AnalyticsVerdict";
import { AnalyticsCardHeader } from "@/components/analytics/AnalyticsCardHeader";
import { buildAnalyticsVerdict } from "@/lib/analytics/verdict";
import { LearningTrendChart } from "@/components/analytics/LearningTrendChart";
import { LearningSignalsCard } from "@/components/analytics/LearningSignalsCard";
import { CourseInvestmentCard } from "@/components/analytics/CourseInvestmentCard";
import { FocusRhythmCard } from "@/components/analytics/FocusRhythmCard";
import { ExecutionQualityCard } from "@/components/analytics/ExecutionQualityCard";
import { AnalyticsCoverageNotice } from "@/components/analytics/AnalyticsCoverageNotice";
import { WeeklyReviewCard } from "@/components/analytics/WeeklyReviewCard";
import { EstimateCalibrationCard } from "@/components/analytics/EstimateCalibrationCard";
import { StudyOutlookCard } from "@/components/analytics/StudyOutlookCard";
import { useStudyOutlook } from "@/hooks/useStudyOutlook";
import { StudyOutlookHorizon } from "@/lib/outlook/types";
import {
  presentCompletedMetric,
  presentCourseInvestment,
  presentExecutionQuality,
  presentFocusMetric,
  presentOnTimeMetric,
  presentPlanExecutionMetric,
  presentPlanMetric,
} from "@/lib/analytics/presentation";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { handleOpenOutlookAssignment } from "@/lib/analytics/outlookAssignmentAction";
import { WorkspaceHeader } from "@/components/layout/WorkspaceHeader";
import { AnalyticsWorkspaceViewBar } from "@/components/analytics/AnalyticsWorkspaceViewBar";
import { DisclosureRegion } from "@/components/ui/DisclosureRegion";

function ChartSkeleton() {
  // 趋势卡终态 ≈ header(33) + pt-3(12) + 图(h-56/224, md:h-64/256) + 卡片 p-4(32) ≈ 300/333；
  // 骨架同高避免加载完推挤下文（此前 h-64 短 50px+）
  // Motion V3 P1：ux-skeleton 扫光（保留 pulse 占位，reduced-motion 下静态）
  return <div className="ux-skeleton h-[300px] md:h-[320px] w-full rounded-xl bg-alabaster animate-pulse" />;
}

/** B2/B9：双并列信息 Card 的统一列几何（Desktop 50/50；Tablet/Mobile 单列）。
 *  Loading Skeleton 与 Loaded 共用同一常量（避免横向 layout shift）。 */
export const ANALYTICS_PAIRED_GRID = "grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch";

function EmptyState() {
  return (
    <div className="bg-surface border border-line rounded-2xl p-10 shadow-subtle flex flex-col items-center justify-center text-center gap-1.5">
      <p className="text-xs font-bold text-charcoal">学习洞察会随着使用逐渐形成</p>
      <p className="text-[11px] text-sandrift leading-relaxed">
        完成 1 个任务或记 1 次专注，这里就会生成趋势图。
      </p>
    </div>
  );
}

/** 学习洞察（Analytics V3）：Truth → Summary → Trend → Insight → Distribution → Execution/Outlook */
export function LearningAnalyticsView() {
  const [preset, setPreset] = useState<AnalyticsRangePreset>("week");
  /** 周回顾展开状态：只属于 component UI state，不持久化 */
  const [reviewExpanded, setReviewExpanded] = useState(false);
  // 渐进披露：下方三个明细分区默认展开、允许收起（E2E 层级契约要求默认齐全可见）
  const [distOpen, setDistOpen] = useState(true);
  const [execOpen, setExecOpen] = useState(true);
  const [nextOpen, setNextOpen] = useState(true);
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

  const navigate = (tab: "assignments" | "timetable" | "courses") => {
    setActiveTab(tab);
  };

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

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {/* App Chrome V2.3：WorkspaceHeader + AnalyticsWorkspaceViewBar（与 Body 同步拉伸，大屏充分利用宽度，保留 24–32px 安全边距）
          S4-2：sticky chrome wrapper（Header + ViewBar 同 Assignments/Timeline 一起钉住；此前 shrink-0 使顶栏随滚） */}
      <div className="sticky top-0 z-20 shrink-0" data-testid="analytics-header-inner">
        <WorkspaceHeader
          title="学习洞察"
          context="从学习历史中理解你的投入与节奏"
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
          className="w-full max-w-none flex flex-col gap-6 workspace-gutter py-4 pb-24 md:py-6 md:pb-6 xl:px-8 xl:py-8 xl:pb-8"
        >
          {/* 历史分析 stage（loading/error/empty/normal 同一容器；preset 变化轻 settle）——
              StudyOutlookCard 在其下方独立存在，不随 preset 重播 */}
          <div key={analyticsStageKey} className="ux-settle flex flex-col gap-6">
          {loading ? (
            <>
              <AnalyticsSummaryStripSkeleton />
              {/* Loading Skeleton 与 Loaded 使用同一 Paired Grid（避免横向 layout shift）；
                  四块统一 ux-skeleton 扫光（此前三块裸 pulse 节奏分裂） */}
              <div className={ANALYTICS_PAIRED_GRID}>
                <ChartSkeleton />
                <div className="h-40 w-full rounded-xl bg-alabaster ux-skeleton" />
              </div>
              <div className={ANALYTICS_PAIRED_GRID}>
                <div className="h-52 w-full rounded-xl bg-alabaster ux-skeleton" />
                <div className="h-40 w-full rounded-xl bg-alabaster ux-skeleton" />
              </div>
            </>
          ) : error ? (
            <div className="bg-danger-bg border border-danger-border rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-semibold text-danger">学习洞察加载失败，请稍后重试。</p>
              <button
                type="button"
                onClick={() => refresh()}
                className="h-7 px-3 rounded-lg bg-surface border border-line text-[11px] font-bold text-charcoal hover:bg-alabaster transition-colors"
              >
                重试
              </button>
            </div>
          ) : data ? (
            <>
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
              {data.isEmpty ? (
                <>
                  <EmptyState />
                  <DisclosureRegion open={reviewExpanded}>
                    <div ref={reviewRef} className="scroll-mt-4">
                      <WeeklyReviewCard snapshot={data} />
                    </div>
                  </DisclosureRegion>
                </>
              ) : (
                <>
                  {/* 结论横幅：一句话判断 + 一步行动（新增表达层，不碰既有标题/数据口径） */}
                  <AnalyticsVerdict
                    verdict={buildAnalyticsVerdict({
                      signals: data.signals,
                      overview: data.overview,
                      comparisonAvailable: data.coverage.comparisonAvailable,
                    })}
                    onAction={navigate}
                  />
                  {/* Summary Strip（一个共同 surface，替代四张独立卡） */}
                  <AnalyticsSummaryStrip metrics={summaryMetrics(data)} />

                  <DisclosureRegion open={reviewExpanded}>
                    <div ref={reviewRef} className="scroll-mt-4">
                      <WeeklyReviewCard snapshot={data} />
                    </div>
                  </DisclosureRegion>

                  {/* 学习趋势（唯一主视觉）+ 值得注意 —— 统一 Paired Grid（50/50；层级由标题/图表/顺序表达） */}
                  <div className={ANALYTICS_PAIRED_GRID}>
                    <div
                      className="bg-surface border border-line rounded-2xl p-4 shadow-subtle"
                      data-testid="learning-trend-card"
                    >
                      <AnalyticsCardHeader eyebrow="走势总览" title="学习趋势" />
                      <div className="pt-3">
                        <LearningTrendChart points={data.trend} period={data.period} animate={trendAnimated} />
                      </div>
                    </div>
                    <LearningSignalsCard signals={data.signals} onNavigate={navigate} />
                  </div>

                  {/* 投入与节奏（Distribution；Course/Rhythm 各自 content-fit，不强制等高） */}
                  <section>
                    <button
                      type="button"
                      onClick={() => setDistOpen((v) => !v)}
                      aria-expanded={distOpen}
                      className="w-full flex items-center justify-between mb-3 text-left group"
                    >
                      <h2 className="text-[13px] font-bold text-charcoal">投入与节奏</h2>
                      <ChevronDown
                        className={cn(
                          "w-3.5 h-3.5 text-sandrift transition-transform duration-[var(--motion-fast)] group-hover:text-charcoal",
                          !distOpen && "-rotate-90"
                        )}
                        aria-hidden="true"
                      />
                    </button>
                    {data.coverage.focusReliability === "partial" && (
                      <p className="text-[10px] text-satin-grey mb-3 -mt-1">
                        专注记录在该区间不完整，以下为已记录部分
                      </p>
                    )}
                    <DisclosureRegion open={distOpen}>
                      <div className={ANALYTICS_PAIRED_GRID}>
                        <CourseInvestmentCard
                          investment={presentCourseInvestment(data.courseInvestment, courseNameById)}
                          onOpenCourse={(courseId) => {
                            if (courseNameById[courseId]) setSelectedCourseId(courseId);
                          }}
                        />
                        <FocusRhythmCard rhythm={data.focusRhythm} />
                      </div>
                    </DisclosureRegion>
                  </section>

                  {/* 执行情况（reliability-aware：partial 只显示已记录，不显示伪精确按时率） */}
                  <section>
                    <button
                      type="button"
                      onClick={() => setExecOpen((v) => !v)}
                      aria-expanded={execOpen}
                      className="w-full flex items-center justify-between mb-3 text-left group"
                    >
                      <h2 className="text-[13px] font-bold text-charcoal">执行情况</h2>
                      <ChevronDown
                        className={cn(
                          "w-3.5 h-3.5 text-sandrift transition-transform duration-[var(--motion-fast)] group-hover:text-charcoal",
                          !execOpen && "-rotate-90"
                        )}
                        aria-hidden="true"
                      />
                    </button>
                    <DisclosureRegion open={execOpen}>
                      <ExecutionQualityCard
                        view={presentExecutionQuality(
                          data.execution,
                          data.coverage.assignmentReliability,
                          data.coverage.focusReliability
                        )}
                      />
                    </DisclosureRegion>
                  </section>
                </>
              )}
            </>
          ) : null}
          </div>

          {/* 下一步：学习前瞻 + 估时参考（独立于历史 Snapshot；确定性；不逐卡查询） */}
          {outlook.error ? (
            <div className="bg-danger-bg border border-danger-border rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-semibold text-danger">学习前瞻加载失败，请稍后重试。</p>
              <button
                type="button"
                onClick={() => outlook.refresh()}
                className="h-7 px-3 rounded-lg bg-surface border border-line text-[11px] font-bold text-charcoal hover:bg-alabaster transition-colors"
              >
                重试
              </button>
            </div>
          ) : outlook.loading && !outlook.data ? (
            <ChartSkeleton />
          ) : outlook.data ? (
            <section>
              <button
                type="button"
                onClick={() => setNextOpen((v) => !v)}
                aria-expanded={nextOpen}
                className="w-full flex items-center justify-between mb-3 text-left group"
              >
                <h2 className="text-[13px] font-bold text-charcoal">下一步</h2>
                <ChevronDown
                  className={cn(
                    "w-3.5 h-3.5 text-sandrift transition-transform duration-[var(--motion-fast)] group-hover:text-charcoal",
                    !nextOpen && "-rotate-90"
                  )}
                  aria-hidden="true"
                />
              </button>
              <DisclosureRegion open={nextOpen}>
                <div className={ANALYTICS_PAIRED_GRID}>
                  <StudyOutlookCard
                    outlook={outlook.data}
                    horizonDays={outlookHorizon}
                    onHorizonChange={setOutlookHorizon}
                    onOpenAssignment={handleOpenOutlookAssignment}
                  />
                  <EstimateCalibrationCard calibration={outlook.data.estimateCalibration} />
                </div>
              </DisclosureRegion>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
