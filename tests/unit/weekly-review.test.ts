import { describe, it, expect } from "vitest";
import { LearningAnalyticsSnapshot } from "@/lib/analytics/types";
import { buildWeeklyReview, weeklyReviewCopy } from "@/lib/analytics/weeklyReview";

/** spec §39 fixture：focus 320 / completed 5 / planned 420 / onTime 4/5 / top course 42% / dominant evening */
function baseSnapshot(overrides: Partial<LearningAnalyticsSnapshot> = {}): LearningAnalyticsSnapshot {
  return {
    period: {
      preset: "week",
      current: { from: new Date(2026, 7, 10).getTime(), to: new Date(2026, 7, 16, 23, 59, 59).getTime() },
      previous: { from: new Date(2026, 7, 3).getTime(), to: new Date(2026, 7, 9, 23, 59, 59).getTime() },
      trendGrain: "day",
    },
    coverage: { fullCoverage: true, comparisonAvailable: true, historyStartedAt: new Date(2026, 6, 1).getTime() },
    overview: {
      actualFocusMinutes: 320,
      actualFocusLabel: "5h 20m",
      focusDeltaPercent: 12,
      completedAssignments: 5,
      plannedMinutes: 420,
      plannedLabel: "7h",
      actualToPlanRatio: 76,
      onTimeCount: 4,
      onTimeEligible: 5,
      onTimeRate: 80,
    },
    trend: [],
    courseInvestment: [{ courseId: "c1", courseName: "概率论", minutes: 134, sessions: 4, share: 0.42 }],
    focusRhythm: {
      byTimeOfDay: [
        { bucket: "深夜", minutes: 0, sessions: 0 },
        { bucket: "上午", minutes: 80, sessions: 2 },
        { bucket: "下午", minutes: 90, sessions: 2 },
        { bucket: "晚间", minutes: 150, sessions: 3 },
      ],
      activeDays: 4,
      averageSessionMinutes: 46,
      longestSessionMinutes: 90,
      dominantTimeOfDay: "晚间",
    },
    execution: {
      uniqueCompletedAssignments: 5,
      reopenedAssignments: 1,
      onTime: 4,
      late: 1,
      onTimeEligible: 5,
      onTimeRate: 80,
      activeDays: 4,
      avgFocusSessionMinutes: 46,
    },
    signals: [
      { id: "focus-up", tone: "positive", title: "专注投入增加", description: "本周期较上一周期 +12%" },
      { id: "plan-actual", tone: "neutral", title: "计划与实际", description: "实际专注约为计划时长的 76%" },
    ],
    isEmpty: false,
    ...overrides,
  };
}

describe("buildWeeklyReview（纯投影）", () => {
  it("完全来自 Snapshot：字段一一对应，不产生新指标", () => {
    const snapshot = baseSnapshot();
    const review = buildWeeklyReview(snapshot);

    expect(review.range).toEqual({ from: snapshot.period.current.from, to: snapshot.period.current.to });
    expect(review.coverage).toEqual({ fullCoverage: true, comparisonAvailable: true });

    // headline 全部来自 overview + rhythm
    expect(review.headline.focusMinutes).toBe(320);
    expect(review.headline.focusLabel).toBe("5h 20m");
    expect(review.headline.completedAssignments).toBe(5);
    expect(review.headline.plannedMinutes).toBe(420);
    expect(review.headline.plannedLabel).toBe("7h");
    expect(review.headline.actualToPlanRatio).toBe(76);
    expect(review.headline.onTimeRate).toBe(80);
    expect(review.headline.onTimeCount).toBe(4);
    expect(review.headline.onTimeEligible).toBe(5);
    expect(review.headline.activeDays).toBe(4);

    // change 来自 overview.focusDeltaPercent；comparisonUnavailable 来自 coverage
    expect(review.change.focusDeltaPercent).toBe(12);
    expect(review.change.comparisonUnavailable).toBe(false);

    // investment 来自 courseInvestment[0]
    expect(review.investment.topCourse?.courseName).toBe("概率论");
    expect(review.investment.topCourse?.minutes).toBe(134);
    expect(review.investment.topCourse?.share).toBeCloseTo(0.42);

    // rhythm 来自 focusRhythm
    expect(review.rhythm.activeDays).toBe(4);
    expect(review.rhythm.averageSessionMinutes).toBe(46);
    expect(review.rhythm.dominantTimeOfDay).toBe("晚间");

    // signals 按 tone 分流
    expect(review.highlights.map((s) => s.id)).toEqual(["focus-up", "plan-actual"]);
    expect(review.attention).toEqual([]);
  });

  it("attention signals 分流；positive/neutral → highlights", () => {
    const snapshot = baseSnapshot({
      signals: [
        { id: "focus-up", tone: "positive", title: "专注投入增加", description: "+12%" },
        { id: "deadline", tone: "attention", title: "截止节奏", description: "4/5 个可判断任务按时完成" },
      ],
    });
    const review = buildWeeklyReview(snapshot);
    expect(review.highlights.map((s) => s.id)).toEqual(["focus-up"]);
    expect(review.attention.map((s) => s.id)).toEqual(["deadline"]);
  });

  it("comparison 不足 → focusDeltaPercent 原样 null + comparisonUnavailable=true（不制造 0%）", () => {
    const snapshot = baseSnapshot({
      coverage: { fullCoverage: true, comparisonAvailable: false, historyStartedAt: new Date(2026, 6, 1).getTime() },
      overview: { ...baseSnapshot().overview, focusDeltaPercent: null },
    });
    const review = buildWeeklyReview(snapshot);
    expect(review.change.focusDeltaPercent).toBeNull();
    expect(review.change.comparisonUnavailable).toBe(true);
  });

  it("空课程投入 → topCourse=null；无 dominant → null", () => {
    const snapshot = baseSnapshot({
      courseInvestment: [],
      focusRhythm: { ...baseSnapshot().focusRhythm, dominantTimeOfDay: null },
    });
    const review = buildWeeklyReview(snapshot);
    expect(review.investment.topCourse).toBeNull();
    expect(review.rhythm.dominantTimeOfDay).toBeNull();
  });

  it("weeklyReviewCopy：确定性文案；比较不足时用替代文案而非 0%", () => {
    const review = buildWeeklyReview(baseSnapshot());
    const copy = weeklyReviewCopy(review);
    expect(copy.headlineLines).toEqual(["本周投入：5h 20m 专注", "完成 5 项任务", "4 天有专注记录"]);
    expect(copy.planActualLines).toEqual(["计划 7h", "实际专注约为计划时长的 76%"]);
    expect(copy.investmentLines).toEqual(["《概率论》2h 14m · 本周专注时间的 42%"]);
    expect(copy.changeLines).toEqual(["较上周同期 +12% 专注时间"]);

    const noCmp = weeklyReviewCopy(
      buildWeeklyReview(
        baseSnapshot({
          coverage: { fullCoverage: true, comparisonAvailable: false, historyStartedAt: 0 },
          overview: { ...baseSnapshot().overview, focusDeltaPercent: null },
        })
      )
    );
    expect(noCmp.changeLines).toEqual(["历史不足，暂无法与上周同期比较"]);
  });

  it("无计划但有专注 → planActual 说明暂无有效计划（不把缺失当 0）", () => {
    const review = buildWeeklyReview(
      baseSnapshot({
        overview: { ...baseSnapshot().overview, plannedMinutes: 0, plannedLabel: "0m", actualToPlanRatio: null },
      })
    );
    const copy = weeklyReviewCopy(review);
    expect(copy.planActualLines).toEqual(["本周暂无已到达开始时间的有效计划"]);
  });
});
