import { describe, it, expect } from "vitest";
import { buildLearningSignals } from "@/lib/analytics/signals";
import { LearningAnalyticsSnapshot } from "@/lib/analytics/types";

function baseSnapshot(overrides: Partial<LearningAnalyticsSnapshot> = {}): LearningAnalyticsSnapshot {
  return {
    period: {
      preset: "week",
      current: { from: 0, to: 100 },
      previous: { from: -100, to: 0 },
      trendGrain: "day",
    },
    coverage: { fullCoverage: true, comparisonAvailable: true, historyStartedAt: -1000, planCoverageFull: true, planCoverageStartedAt: -1000 },
    overview: {
      actualFocusMinutes: 300,
      actualFocusLabel: "5h",
      focusDeltaPercent: null,
      completedAssignments: 4,
      plannedMinutes: 240,
      plannedLabel: "4h",
      actualToPlanRatio: 125,
      onTimeCount: 3,
      onTimeEligible: 4,
      onTimeRate: 75,
    },
    trend: [],
    courseInvestment: [{ courseId: "c1", courseName: "数据结构", minutes: 200, sessions: 4, share: 0.67 }],
    focusRhythm: {
      byTimeOfDay: [
        { bucket: "上午", minutes: 200, sessions: 6 },
        { bucket: "下午", minutes: 100, sessions: 2 },
        { bucket: "深夜", minutes: 0, sessions: 0 },
        { bucket: "晚间", minutes: 0, sessions: 0 },
      ],
      activeDays: 3,
      averageSessionMinutes: 50,
      longestSessionMinutes: 90,
      dominantTimeOfDay: "上午",
    },
    execution: {
      uniqueCompletedAssignments: 4,
      reopenedAssignments: 1,
      onTime: 3,
      late: 1,
      onTimeEligible: 4,
      onTimeRate: 75,
      activeDays: 3,
      avgFocusSessionMinutes: 50,
    },
    signals: [],
    isEmpty: false,
    ...overrides,
  };
}

const CTX = { previousFocusMinutes: 200, plannedMinutes: 240 };

describe("Learning Signals", () => {
  it("focus-up：对比可用且增长 ≥1% 时输出 positive", () => {
    const signals = buildLearningSignals(baseSnapshot(), CTX);
    const s = signals.find((x) => x.id === "focus-up");
    expect(s?.tone).toBe("positive");
    expect(s?.title).toBe("专注投入增加");
    expect(s?.description).toContain("+50%");
  });

  it("focus-down：下降时 attention", () => {
    const signals = buildLearningSignals(baseSnapshot(), { ...CTX, previousFocusMinutes: 400 });
    const s = signals.find((x) => x.id === "focus-down");
    expect(s?.tone).toBe("attention");
    expect(s?.description).toContain("-25%");
  });

  it("comparison 不可用 → 不生成 period change 信号", () => {
    const signals = buildLearningSignals(
      baseSnapshot({ coverage: { fullCoverage: true, comparisonAvailable: false, historyStartedAt: -1000, planCoverageFull: true, planCoverageStartedAt: -1000 } }),
      CTX
    );
    expect(signals.find((x) => x.id === "focus-up")).toBeUndefined();
  });

  it("previous 不足 60min → 不生成 period change 信号", () => {
    const signals = buildLearningSignals(baseSnapshot(), { ...CTX, previousFocusMinutes: 30 });
    expect(signals.find((x) => x.id === "focus-up")).toBeUndefined();
  });

  it("plan-actual：计划 ≥120min 且 ratio 可算时生成", () => {
    const signals = buildLearningSignals(baseSnapshot(), CTX);
    const s = signals.find((x) => x.id === "plan-actual");
    expect(s?.tone).toBe("positive");
    expect(s?.description).toContain("125%");
  });

  it("planCoverageFull=false → 不生成 plan-actual 信号（计划分母可能缺失）", () => {
    const signals = buildLearningSignals(
      baseSnapshot({
        coverage: { fullCoverage: true, comparisonAvailable: true, historyStartedAt: -1000, planCoverageFull: false, planCoverageStartedAt: 0 },
      }),
      CTX
    );
    expect(signals.find((x) => x.id === "plan-actual")).toBeUndefined();
  });

  it("计划不足 → 不生成 plan-actual", () => {
    const signals = buildLearningSignals(baseSnapshot({ overview: { ...baseSnapshot().overview, plannedMinutes: 90, actualToPlanRatio: 200 } }), {
      previousFocusMinutes: 200,
      plannedMinutes: 90,
    });
    expect(signals.find((x) => x.id === "plan-actual")).toBeUndefined();
  });

  it("deadline：eligible ≥3 且 rate ≥70 → positive；rate <70 → attention + 动作", () => {
    const ok = buildLearningSignals(baseSnapshot(), CTX).find((x) => x.id === "deadline");
    expect(ok?.tone).toBe("positive");

    const bad = buildLearningSignals(
      baseSnapshot({
        overview: { ...baseSnapshot().overview, onTimeCount: 1, onTimeRate: 25 },
        execution: { ...baseSnapshot().execution, onTime: 1, late: 3, onTimeRate: 25 },
      }),
      CTX
    ).find((x) => x.id === "deadline");
    expect(bad?.tone).toBe("attention");
    expect(bad?.action?.label).toBe("查看任务");
    expect(bad?.action?.targetTab).toBe("assignments");
  });

  it("eligible <3 → 不生成 deadline 信号", () => {
    const signals = buildLearningSignals(
      baseSnapshot({
        overview: { ...baseSnapshot().overview, onTimeCount: 1, onTimeEligible: 2, onTimeRate: 50 },
        execution: { ...baseSnapshot().execution, onTime: 1, onTimeEligible: 2, onTimeRate: 50 },
      }),
      CTX
    );
    expect(signals.find((x) => x.id === "deadline")).toBeUndefined();
  });

  it("course-concentration：专注 ≥120min 且 Top 占比 ≥45%", () => {
    // 隔离：无对比 / 计划不足 / deadline 样本不足 → course-concentration 排第一
    const signals = buildLearningSignals(
      baseSnapshot({
        overview: { ...baseSnapshot().overview, onTimeCount: 1, onTimeEligible: 2, onTimeRate: 50 },
        execution: { ...baseSnapshot().execution, onTime: 1, onTimeEligible: 2, onTimeRate: 50 },
      }),
      { previousFocusMinutes: null, plannedMinutes: 90 }
    );
    expect(signals.length).toBeGreaterThanOrEqual(1);
    const s = signals.find((x) => x.id === "course-concentration");
    expect(s?.tone).toBe("neutral");
    expect(s?.description).toContain("数据结构");
    expect(s?.description).toContain("67%");
  });

  it("focus-rhythm：dominant 存在时生成", () => {
    const signals = buildLearningSignals(
      baseSnapshot({
        overview: { ...baseSnapshot().overview, onTimeCount: 1, onTimeEligible: 2, onTimeRate: 50 },
        execution: { ...baseSnapshot().execution, onTime: 1, onTimeEligible: 2, onTimeRate: 50 },
      }),
      { previousFocusMinutes: null, plannedMinutes: 90 }
    );
    const s = signals.find((x) => x.id === "focus-rhythm");
    expect(s?.description).toBe("你的专注主要集中在上午");
  });

  it("最多 3 条 primary signals，按优先级顺序", () => {
    const signals = buildLearningSignals(baseSnapshot(), CTX);
    expect(signals.length).toBe(3);
    expect(signals.map((s) => s.id)).toEqual(["focus-up", "plan-actual", "deadline"]);
  });
});
