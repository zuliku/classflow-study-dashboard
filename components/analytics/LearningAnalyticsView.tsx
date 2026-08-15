"use client";

import React, { useRef, useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import {
  AnalyticsRangePreset,
  LearningAnalyticsSnapshot,
} from "@/lib/analytics/types";
import { useLearningAnalytics } from "@/hooks/useLearningAnalytics";
import { useEffectiveReducedMotion } from "@/hooks/useEffectiveReducedMotion";
import { AnalyticsRangeSelector } from "@/components/analytics/AnalyticsRangeSelector";
import { AnalyticsMetricCard } from "@/components/analytics/AnalyticsMetricCard";
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
import { cn } from "@/lib/utils";

function MetricSkeleton() {
  return (
    <div className="p-4 bg-surface border border-line rounded-2xl shadow-subtle space-y-2">
      <div className="h-3 w-16 rounded bg-alabaster animate-pulse" />
      <div className="h-7 w-20 rounded bg-alabaster animate-pulse" />
      <div className="h-3 w-24 rounded bg-alabaster animate-pulse" />
    </div>
  );
}

function ChartSkeleton() {
  return <div className="h-56 w-full rounded-xl bg-alabaster animate-pulse" />;
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

/** 学习洞察工作区（Analytics V2 + Weekly Review） */
export function LearningAnalyticsView() {
  const [preset, setPreset] = useState<AnalyticsRangePreset>("week");
  /** 周回顾展开状态：只属于 component UI state，不持久化 */
  const [reviewExpanded, setReviewExpanded] = useState(false);
  const reviewRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = useEffectiveReducedMotion();
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const { data, loading, error } = useLearningAnalytics(preset);
  const [outlookHorizon, setOutlookHorizon] = useState<StudyOutlookHorizon>(7);
  const outlook = useStudyOutlook(outlookHorizon);

  const navigate = (tab: "assignments" | "timetable" | "courses") => {
    setActiveTab(tab);
  };

  /** 周回顾：切到 week preset + 展开 + 滚动到卡片（尊重 reduced-motion） */
  const openWeeklyReview = () => {
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

  const renderMetrics = (d: LearningAnalyticsSnapshot) => (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <AnalyticsMetricCard
        label="实际专注"
        value={d.overview.actualFocusLabel}
        sub={d.coverage.comparisonAvailable ? undefined : "历史不足，暂无法比较"}
        delta={
          d.coverage.comparisonAvailable && d.overview.focusDeltaPercent !== null
            ? { percent: d.overview.focusDeltaPercent }
            : null
        }
      />
      <AnalyticsMetricCard
        label="完成任务"
        value={`${d.overview.completedAssignments} 项`}
        sub="本周期至少完成过一次的任务"
      />
      <AnalyticsMetricCard label="计划学习" value={d.overview.plannedLabel} sub="已到达开始时间的有效计划" />
      <AnalyticsMetricCard
        label="按时完成"
        value={d.overview.onTimeRate !== null ? `${d.overview.onTimeRate}%` : "—"}
        sub={
          d.overview.onTimeEligible === 0
            ? "暂无可靠截止时间可判断"
            : d.overview.onTimeEligible < 3
              ? `样本不足 · ${d.overview.onTimeEligible} 个可判断任务`
              : `${d.overview.onTimeCount} / ${d.overview.onTimeEligible} 个可判断任务按时完成`
        }
      />
    </div>
  );

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-line shrink-0 gap-3 flex-wrap">
        <div>
          <h1 className="text-base font-bold text-charcoal">学习洞察</h1>
          <p className="text-[11px] text-sandrift mt-0.5">从学习历史中理解你的投入与节奏</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-pressed={reviewExpanded}
            onClick={openWeeklyReview}
            className={cn(
              "px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap transition-colors duration-[var(--motion-fast)]",
              reviewExpanded
                ? "bg-alabaster text-charcoal border border-line-strong"
                : "bg-transparent text-sandrift border border-line hover:text-charcoal hover:border-line-strong"
            )}
          >
            周回顾
          </button>
          <AnalyticsRangeSelector value={preset} onChange={changePreset} />
        </div>
      </div>

      <div className="flex flex-1 min-h-0 flex-col gap-4 p-4 md:p-6 overflow-y-auto">
        {loading ? (
          <>
            <AnalyticsMetricCard label="实际专注" value="—" sub="加载中…" delta={null} />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[0, 1, 2].map((i) => (
                <MetricSkeleton key={i} />
              ))}
            </div>
            <ChartSkeleton />
          </>
        ) : error ? (
          <div className="bg-danger-bg border border-danger-border rounded-2xl p-4 text-xs font-semibold text-danger">
            学习洞察加载失败，请稍后重试。
          </div>
        ) : data ? (
          <>
            {!data.coverage.fullCoverage && (
              <AnalyticsCoverageNotice
                fullCoverage={data.coverage.fullCoverage}
                historyStartedAt={data.coverage.historyStartedAt}
              />
            )}
            {data.isEmpty ? (
              <>
                <EmptyState />
                {reviewExpanded && (
                  <div ref={reviewRef}>
                    <WeeklyReviewCard snapshot={data} />
                  </div>
                )}
              </>
            ) : (
              <>
                {renderMetrics(data)}

                {reviewExpanded && (
                  <div ref={reviewRef}>
                    <WeeklyReviewCard snapshot={data} />
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div className="lg:col-span-2 bg-surface border border-line rounded-2xl p-4 shadow-subtle">
                    <h3 className="text-sm font-bold text-charcoal pb-2 border-b border-[#F0EBE1]">学习趋势</h3>
                    <LearningTrendChart points={data.trend} />
                  </div>
                  <LearningSignalsCard signals={data.signals} onNavigate={navigate} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <CourseInvestmentCard investment={data.courseInvestment} />
                  <FocusRhythmCard rhythm={data.focusRhythm} />
                </div>

                <ExecutionQualityCard execution={data.execution} />
              </>
            )}
          </>
        ) : null}

        {/* 学习前瞻 + 估时参考（独立于历史 Snapshot；确定性；不逐卡查询） */}
        {outlook.error ? (
          <div className="bg-danger-bg border border-danger-border rounded-2xl p-4 text-xs font-semibold text-danger">
            学习前瞻加载失败，请稍后重试。
          </div>
        ) : outlook.loading && !outlook.data ? (
          <ChartSkeleton />
        ) : outlook.data ? (
          <>
            <StudyOutlookCard
              outlook={outlook.data}
              horizonDays={outlookHorizon}
              onHorizonChange={setOutlookHorizon}
            />
            <EstimateCalibrationCard calibration={outlook.data.estimateCalibration} />
          </>
        ) : null}
      </div>
    </div>
  );
}
