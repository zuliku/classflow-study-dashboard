"use client";

import React, { useMemo } from "react";
import { CalendarPlus, Clock3, Flame, TrendingDown, TrendingUp } from "lucide-react";
import { LearningAnalyticsSnapshot } from "@/lib/analytics/types";
import { buildWeeklyReview, weeklyReviewCopy } from "@/lib/analytics/weeklyReview";
import { useKiroSessionActions } from "@/components/kiro/KiroSessionProvider";
import { KiroFlowButton } from "@/components/kiro/KiroFlow";
import { KiroLogoIcon } from "@/components/kiro/KiroLogo";
import { AnalyticsCardHeader } from "@/components/analytics/AnalyticsCardHeader";
import { cn } from "@/lib/utils";

const DEEP_REVIEW_PROMPT =
  "帮我复盘下这周：总结投入和完成情况，再指出 2-3 个最值得调整的地方。只用我的真实学习数据，别打分。";

const PLAN_NEXT_WEEK_PROMPT =
  "结合我本周的学习洞察和未来 7 天任务，帮我规划下一阶段学习。先判断哪些任务最需要安排，再给出可执行的学习计划建议。";

function formatMD(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatShortDate(key: string): string {
  const parts = key.split("-");
  if (parts.length !== 3) return key;
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

/** 本周回顾（ephemeral deterministic projection；不访问 IndexedDB；不重复计算指标） */
export function WeeklyReviewCard({
  snapshot,
  courseNameById = {},
}: {
  snapshot: LearningAnalyticsSnapshot;
  /** 当前课程名解析（历史 snapshot 的名称可能缺失或已重命名） */
  courseNameById?: Record<string, string>;
}) {
  const review = useMemo(() => buildWeeklyReview(snapshot), [snapshot]);
  const copy = useMemo(() => weeklyReviewCopy(review), [review]);
  const { handoffPrompt } = useKiroSessionActions();

  const isEmpty = snapshot.isEmpty;
  const headline = review.headline;
  const trend = review.trend.filter(
    (point): point is (typeof review.trend)[number] & { focusMinutes: number } =>
      point.focusMinutes !== null
  );
  const trendMax = Math.max(1, ...trend.map((point) => point.focusMinutes));
  const planRatio =
    review.coverage.planCoverageFull && headline.actualToPlanRatio !== null
      ? Math.max(0, Math.min(100, headline.actualToPlanRatio))
      : null;
  const delta = review.change.focusDeltaPercent;

  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden" data-testid="weekly-review-card">
      <div className="px-4 pt-4 pb-3 border-b border-line-soft">
        <AnalyticsCardHeader
          title="本周回顾"
          action={
            <span className="text-[10px] font-medium text-sandrift shrink-0">
              {formatMD(review.range.from)} – {formatMD(review.range.to)}
            </span>
          }
        />
      </div>

      {isEmpty ? (
        <div className="px-4 py-6 flex flex-col items-center justify-center text-center gap-1.5">
          <p className="text-[13px] font-semibold text-charcoal">本周还没有足够的学习记录</p>
          <KiroFlowButton
            icon={KiroLogoIcon}
            label="让 Kiro 帮我规划本周"
            size="sm"
            className="mt-2 self-center"
            onClick={() => handoffPrompt(PLAN_NEXT_WEEK_PROMPT)}
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-line-soft">
            <div className="px-4 py-3">
              <p className="text-[11px] font-medium text-sandrift">专注</p>
              <p className="text-[18px] font-semibold tracking-[-0.01em] text-charcoal mt-0.5">{headline.focusLabel}</p>
              {review.change.comparisonUnavailable ? (
                <p className="mt-0.5 text-[10px] text-sandrift">历史不足，暂不比较</p>
              ) : delta !== null ? (
                <p
                  className={cn(
                    "mt-0.5 flex items-center gap-1 text-[10px] font-semibold tabular-nums",
                    delta >= 0 ? "text-success" : "text-sandrift"
                  )}
                >
                  {delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  较上周 {delta >= 0 ? "+" : ""}
                  {delta}%
                </p>
              ) : null}
            </div>
            <div className="px-4 py-3">
              <p className="text-[11px] font-medium text-sandrift">完成任务</p>
              <p className="text-[18px] font-semibold tracking-[-0.01em] text-charcoal mt-0.5">{headline.completedAssignments} 项</p>
              {review.execution.lateAssignments > 0 && (
                <p className="mt-0.5 text-[10px] text-sandrift tabular-nums">
                  {review.execution.lateAssignments} 项晚于截止
                </p>
              )}
            </div>
            <div className="px-4 py-3">
              <p className="text-[11px] font-medium text-sandrift">专注天数</p>
              <p className="text-[18px] font-semibold tracking-[-0.01em] text-charcoal mt-0.5">{headline.activeDays} 天</p>
              {review.rhythm.longestSessionMinutes > 0 && (
                <p className="mt-0.5 text-[10px] text-sandrift tabular-nums">
                  最长 {review.rhythm.longestSessionMinutes} 分钟
                </p>
              )}
            </div>
            <div className="px-4 py-3">
              <p className="text-[11px] font-medium text-sandrift">按时完成</p>
              <p className="text-[18px] font-semibold tracking-[-0.01em] text-charcoal mt-0.5">
                {headline.onTimeRate !== null ? `${headline.onTimeRate}%` : "—"}
              </p>
              <p className="mt-0.5 text-[10px] text-sandrift tabular-nums">
                {headline.onTimeEligible > 0
                  ? `${headline.onTimeCount} / ${headline.onTimeEligible} 可判断`
                  : "暂无可靠截止时间"}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 border-t border-line-soft px-4 py-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-semibold text-charcoal">计划与实际</p>
                {planRatio !== null && (
                  <span className="text-[10px] font-semibold tabular-nums text-sandrift">{planRatio}%</span>
                )}
              </div>
              {planRatio !== null ? (
                <>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-alabaster">
                    <div
                      className="h-full origin-left rounded-full bg-charcoal/65 transition-transform duration-[var(--motion-data)] ease-[var(--ease-standard)]"
                      style={{ transform: `scaleX(${Math.max(0, Math.min(1, planRatio / 100))})` }}
                    />
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-sandrift">
                    {copy.planActualLines.join("；")}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-[10px] leading-relaxed text-sandrift">
                  {copy.planActualLines[0] ?? "本周期没有已到达开始时间的有效计划。"}
                </p>
              )}

              {trend.length > 0 && (
                <div className="mt-3" data-testid="weekly-review-trend">
                  <div className="flex items-end gap-1.5" aria-hidden="true">
                    {trend.map((point) => (
                      <div key={point.key} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                        <div className="flex h-10 w-full items-end">
                          <div
                            className="h-full w-full origin-bottom rounded-sm bg-charcoal/20 transition-transform duration-[var(--motion-data)] ease-[var(--ease-standard)]"
                            style={{
                              transform: `scaleY(${Math.max(
                                0.06,
                                Math.min(1, point.focusMinutes / trendMax)
                              )})`,
                            }}
                          />
                        </div>
                        <span className="truncate text-[9px] tabular-nums text-sandrift">
                          {formatShortDate(point.key)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {trend.length === 0 && (
                <p className="mt-3 text-[10px] text-sandrift">本周期没有逐日专注记录。</p>
              )}
            </div>

            <div className="min-w-0 lg:border-l lg:border-line-soft lg:pl-4">
              <p className="text-[11px] font-semibold text-charcoal">时间去向</p>
              {review.investment.courses.length === 0 ? (
                <p className="mt-1 text-[10px] text-sandrift">完成专注后显示课程投入。</p>
              ) : (
                <div className="mt-2 space-y-2" data-testid="weekly-review-courses">
                  {review.investment.courses.map((course) => (
                    <div key={course.courseId ?? course.courseName ?? "none"} className="min-w-0">
                      <div className="flex items-center justify-between gap-2 text-[10px]">
                        <span className="truncate font-semibold text-charcoal">
                          {course.courseName ??
                            (course.courseId ? courseNameById[course.courseId] : undefined) ??
                            "已删除课程"}
                        </span>
                        <span className="shrink-0 tabular-nums text-sandrift">
                          {Math.round(course.share * 100)}%
                        </span>
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-alabaster">
                        <div
                          className="h-full origin-left rounded-full bg-charcoal/35 transition-transform duration-[var(--motion-data)] ease-[var(--ease-standard)]"
                          style={{ transform: `scaleX(${Math.max(0.02, Math.min(1, course.share))})` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line-soft pt-2 text-[10px] text-sandrift">
                <span className="flex items-center gap-1">
                  <Flame className="h-3 w-3" />
                  {review.rhythm.dominantTimeOfDay ? `${review.rhythm.dominantTimeOfDay}最专注` : "暂无主导时段"}
                </span>
                <span className="flex items-center gap-1 tabular-nums">
                  <Clock3 className="h-3 w-3" />
                  {review.rhythm.averageSessionMinutes !== null
                    ? `单次平均 ${review.rhythm.averageSessionMinutes} 分钟`
                    : "暂无单次时长"}
                </span>
              </div>
            </div>
          </div>

          {(copy.highlightLines.length > 0 || copy.attentionLines.length > 0) && (
            <div className="border-t border-line-soft px-4 py-3">
              {copy.highlightLines.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold text-charcoal">可以保持</p>
                  {copy.highlightLines.map((line, i) => (
                    <p key={`h-${i}`} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-satin-grey">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-success/70" />
                      {line}
                    </p>
                  ))}
                </div>
              )}
              {copy.attentionLines.length > 0 && (
                <div className={cn("space-y-1", copy.highlightLines.length > 0 && "mt-2.5")}>
                  <p className="text-[11px] font-semibold text-charcoal">需要关注</p>
                  {copy.attentionLines.map((line, i) => (
                    <p key={`a-${i}`} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-satin-grey">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-warning/80" />
                      {line}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="border-t border-line-soft px-4 py-3 flex flex-wrap items-center gap-2">
            <KiroFlowButton
              icon={KiroLogoIcon}
              label="让 Kiro 深入复盘"
              size="sm"
              onClick={() => handoffPrompt(DEEP_REVIEW_PROMPT)}
            />
            <button
              type="button"
              onClick={() => handoffPrompt(PLAN_NEXT_WEEK_PROMPT)}
              className="ux-press inline-flex items-center gap-1.5 rounded-lg border border-line bg-transparent px-3 py-1.5 text-[11px] font-semibold text-charcoal transition-colors hover:bg-alabaster"
            >
              <CalendarPlus className="w-3.5 h-3.5" />
              规划下周
            </button>
          </div>
        </>
      )}
    </div>
  );
}
