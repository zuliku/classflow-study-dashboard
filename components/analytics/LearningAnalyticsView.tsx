"use client";

import React, { useRef, useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { AnalyticsRangePreset, LearningAnalyticsSnapshot } from "@/lib/analytics/types";
import { useLearningAnalytics } from "@/hooks/useLearningAnalytics";
import { useEffectiveReducedMotion } from "@/hooks/useEffectiveReducedMotion";
import { AnalyticsRangeSelector } from "@/components/analytics/AnalyticsRangeSelector";
import {
  AnalyticsSummaryStrip,
  AnalyticsSummaryStripSkeleton,
} from "@/components/analytics/AnalyticsSummaryStrip";
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
import { ChevronRight } from "lucide-react";

function ChartSkeleton() {
  return <div className="h-64 w-full rounded-xl bg-alabaster animate-pulse" />;
}

function EmptyState() {
  return (
    <div className="bg-surface border border-line rounded-2xl p-10 shadow-subtle flex flex-col items-center justify-center text-center gap-1.5">
      <p className="text-xs font-bold text-charcoal">学习洞察会随着使用逐渐形成</p>
      <p className="text-[11px] text-sandrift leading-relaxed">
        完成任务、安排学习计划或进行专注后，
        <br />
        这里会展示你的学习趋势。
      </p>
    </div>
  );
}

/** 学习洞察（Analytics V3）：Truth → Summary → Trend → Insight → Distribution → Execution/Outlook */
export function LearningAnalyticsView() {
  const [preset, setPreset] = useState<AnalyticsRangePreset>("week");
  /** 周回顾展开状态：只属于 component UI state，不持久化 */
  const [reviewExpanded, setReviewExpanded] = useState(false);
  const reviewRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = useEffectiveReducedMotion();
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setSelectedCourseId = useAppStore((s) => s.setSelectedCourseId);
  const courses = useAppStore((s) => s.courses);
  const { data, loading, error } = useLearningAnalytics(preset);
  const [outlookHorizon, setOutlookHorizon] = useState<StudyOutlookHorizon>(7);
  const outlook = useStudyOutlook(outlookHorizon);

  const courseNameById = Object.fromEntries(courses.map((c) => [c.id, c.name]));

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
      {/* Header：与 Body 同 max-width 对齐（V3 宽屏不再贴边） */}
      <div className="shrink-0 border-b border-line">
        <div
          data-testid="analytics-header-inner"
          className="w-full max-w-[1500px] mx-auto flex items-center justify-between px-6 pt-5 pb-3 gap-3 flex-wrap"
        >
          <div>
            <h1 className="text-base font-bold text-charcoal">学习洞察</h1>
            <p className="text-[11px] text-sandrift mt-0.5">从学习历史中理解你的投入与节奏</p>
          </div>
          {/* V3.1：周回顾是独立 workflow action（与 range selector 视觉分离，非第四种 selection） */}
          <div className="flex w-full md:w-auto items-center justify-between gap-2">
            <AnalyticsRangeSelector value={preset} onChange={changePreset} />
            <button
              type="button"
              aria-pressed={reviewExpanded}
              aria-expanded={reviewExpanded}
              onClick={toggleWeeklyReview}
              data-testid="weekly-review-action"
              className={cn(
                "shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap transition-colors duration-[var(--motion-fast)]",
                reviewExpanded
                  ? "text-sandrift bg-alabaster border border-line-strong"
                  : "text-sandrift bg-transparent border border-line hover:text-charcoal hover:border-line-strong"
              )}
            >
              {reviewExpanded ? "收起周回顾" : "周回顾"}
              <ChevronRight
                className={cn("w-3 h-3 transition-transform duration-[var(--motion-fast)]", reviewExpanded && "rotate-90")}
              />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div
          data-testid="analytics-body"
          className="w-full max-w-[1500px] mx-auto flex flex-col gap-6 p-4 md:p-6"
        >
          {loading ? (
            <>
              <AnalyticsSummaryStripSkeleton />
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(280px,0.8fr)] gap-4 items-start">
                <ChartSkeleton />
                <div className="h-40 w-full rounded-xl bg-alabaster animate-pulse" />
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                <div className="h-52 w-full rounded-xl bg-alabaster animate-pulse" />
                <div className="h-40 w-full rounded-xl bg-alabaster animate-pulse" />
              </div>
            </>
          ) : error ? (
            <div className="bg-danger-bg border border-danger-border rounded-2xl p-4 text-xs font-semibold text-danger">
              学习洞察加载失败，请稍后重试。
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
                  {reviewExpanded && (
                    <div ref={reviewRef} className="scroll-mt-4">
                      <WeeklyReviewCard snapshot={data} />
                    </div>
                  )}
                </>
              ) : (
                <>
                  {/* Summary Strip（一个共同 surface，替代四张独立卡） */}
                  <AnalyticsSummaryStrip metrics={summaryMetrics(data)} />

                  {reviewExpanded && (
                    <div ref={reviewRef} className="scroll-mt-4">
                      <WeeklyReviewCard snapshot={data} />
                    </div>
                  )}

                  {/* 学习趋势（唯一主视觉）+ 值得注意 */}
                  <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(280px,0.8fr)] gap-4 items-start">
                    <div className="bg-surface border border-line rounded-2xl p-4 shadow-subtle">
                      <h3 className="text-sm font-bold text-charcoal pb-2 border-b border-[#F0EBE1]">
                        学习趋势
                      </h3>
                      <div className="pt-3">
                        <LearningTrendChart points={data.trend} period={data.period} />
                      </div>
                    </div>
                    <LearningSignalsCard signals={data.signals} onNavigate={navigate} />
                  </div>

                  {/* 投入与节奏（Distribution；Course/Rhythm 各自 content-fit，不强制等高） */}
                  <section>
                    <h2 className="text-[13px] font-bold text-charcoal mb-3">投入与节奏</h2>
                    {data.coverage.focusReliability === "partial" && (
                      <p className="text-[10px] text-satin-grey mb-3 -mt-1">
                        专注记录在该区间不完整，以下为已记录部分
                      </p>
                    )}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                      <CourseInvestmentCard
                        investment={presentCourseInvestment(data.courseInvestment, courseNameById)}
                        onOpenCourse={(courseId) => {
                          if (courseNameById[courseId]) setSelectedCourseId(courseId);
                        }}
                      />
                      <FocusRhythmCard rhythm={data.focusRhythm} />
                    </div>
                  </section>

                  {/* 执行情况（reliability-aware：partial 只显示已记录，不显示伪精确按时率） */}
                  <section>
                    <h2 className="text-[13px] font-bold text-charcoal mb-3">执行情况</h2>
                    <ExecutionQualityCard
                      view={presentExecutionQuality(
                        data.execution,
                        data.coverage.assignmentReliability,
                        data.coverage.focusReliability
                      )}
                    />
                  </section>
                </>
              )}
            </>
          ) : null}

          {/* 下一步：学习前瞻 + 估时参考（独立于历史 Snapshot；确定性；不逐卡查询） */}
          {outlook.error ? (
            <div className="bg-danger-bg border border-danger-border rounded-2xl p-4 text-xs font-semibold text-danger">
              学习前瞻加载失败，请稍后重试。
            </div>
          ) : outlook.loading && !outlook.data ? (
            <ChartSkeleton />
          ) : outlook.data ? (
            <section>
              <h2 className="text-[13px] font-bold text-charcoal mb-3">下一步</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                <StudyOutlookCard
                  outlook={outlook.data}
                  horizonDays={outlookHorizon}
                  onHorizonChange={setOutlookHorizon}
                />
                <EstimateCalibrationCard calibration={outlook.data.estimateCalibration} />
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
