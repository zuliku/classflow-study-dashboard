import { describe, it, expect, beforeEach } from "vitest";
import {
  AnalyticsPeriod,
  CourseInvestment,
} from "@/lib/analytics/types";
import {
  formatAnalyticsDuration,
  presentCompletedMetric,
  presentExecutionQuality,
  presentFocusMetric,
  presentOnTimeMetric,
  presentPlanExecutionMetric,
  presentPlanMetric,
  presentCourseInvestment,
  resolveCourseInvestmentName,
  formatTrendBucketLabel,
  formatTrendTooltip,
  buildCoverageFactLines,
  buildCoverageSummary,
  summaryCellDividerClasses,
} from "@/lib/analytics/presentation";
import {
  buildLearningAnalyticsSnapshot,
  buildTrendPoints,
  generateTrendBuckets,
} from "@/lib/analytics/learningAnalytics";
import { LearningHistoryEvent } from "@/lib/history/types";
import { buildLearningHistoryEvent, resolveLearningMutationContext } from "@/lib/history/recorder";
import { appendLearningHistoryEvents, clearLearningHistoryStorage, setLearningHistoryCoverage } from "@/lib/history/store";

const DAY = 86400000;
const NOW = new Date(2026, 7, 23, 20, 0, 0).getTime(); // 2026-08-23 周日 20:00
const SEMESTER = { id: "sem1", name: "测试学期", startDate: "2026-08-03", totalWeeks: 16 };
const ENV = { semester: SEMESTER };

function mkFocus(
  entityId: string,
  startedAt: number,
  courseId?: string,
  courseNameSnapshot?: string,
  minutes = 20
): LearningHistoryEvent {
  return {
    ...buildLearningHistoryEvent({
      type: "focus.completed",
      entityType: "focus-session",
      entityId,
      data: { actualActiveMs: minutes * 60000, startedAt, plannedMinutes: minutes },
      context: resolveLearningMutationContext({ source: "manual", occurredAt: startedAt }),
      environment: ENV,
      courseId,
      courseNameSnapshot,
    }),
  } as LearningHistoryEvent;
}

beforeEach(async () => {
  await clearLearningHistoryStorage();
  await setLearningHistoryCoverage({
    schemaVersion: 1,
    historyStartedAt: new Date(2026, 7, 1).getTime(),
    initializedAt: new Date(2026, 7, 1).getTime(),
    focusBackfillCompleted: false,
    backfilledFocusSessions: 0,
  });
});

function weekPeriod(): AnalyticsPeriod {
  return {
    preset: "week",
    current: { from: new Date(2026, 7, 17, 0, 0, 0).getTime(), to: NOW },
    previous: { from: new Date(2026, 7, 10, 0, 0, 0).getTime(), to: new Date(2026, 7, 17, 0, 0, 0).getTime() },
    trendGrain: "day",
  };
}

function fourWeekPeriod(): AnalyticsPeriod {
  return {
    preset: "4weeks",
    current: { from: NOW - 28 * DAY, to: NOW },
    previous: { from: NOW - 56 * DAY, to: NOW - 28 * DAY },
    trendGrain: "week",
  };
}

function semesterPeriod(): AnalyticsPeriod {
  return {
    preset: "semester",
    current: { from: new Date(2026, 7, 3, 0, 0, 0).getTime(), to: NOW },
    previous: null,
    trendGrain: "semester-week",
  };
}

const mkInvestment = (patch: Partial<CourseInvestment>): CourseInvestment => ({
  courseId: null,
  courseName: null,
  minutes: 0,
  sessions: 0,
  share: 0,
  ...patch,
});

describe("Course Investment identity", () => {
  it("A：不同 courseId 缺 snapshot → 不出现重复「未关联课程」（resolve 到 current / 已删除课程）", () => {
    const rows = [
      mkInvestment({ courseId: "c1", courseName: null, minutes: 30 }),
      mkInvestment({ courseId: "c2", courseName: null, minutes: 20 }),
      mkInvestment({ courseId: "c3", courseName: null, minutes: 10 }),
    ];
    const view = presentCourseInvestment(rows, { c1: "数据结构", c2: "概率论" });
    expect(view.map((v) => v.courseName)).toEqual(["数据结构", "概率论", "已删除课程"]);
    expect(view.filter((v) => v.courseName === "未关联课程")).toHaveLength(0);
  });

  it("B：真 unlinked（courseId undefined）→ builder 聚合为唯一一条「未关联课程」", async () => {
    const at = (d: number, h: number, m = 0) => new Date(2026, 7, d, h, m, 0, 0).getTime();
    await appendLearningHistoryEvents([
      mkFocus("u1", at(17, 9), undefined, undefined, 20),
      mkFocus("u2", at(17, 10), undefined, undefined, 35),
      mkFocus("f1", at(18, 9), "c1", "数据结构与算法", 30),
    ]);
    const snapshot = await buildLearningAnalyticsSnapshot({
      preset: "week",
      semester: SEMESTER,
      now: NOW,
    });
    const unlinked = snapshot.courseInvestment.filter((i) => i.courseId === null);
    expect(unlinked).toHaveLength(1);
    expect(unlinked[0].courseName).toBe("未关联课程");
    expect(unlinked[0].minutes).toBe(55);
    expect(unlinked[0].sessions).toBe(2);
    // linked 课程不误标「未关联」
    expect(snapshot.courseInvestment.some((i) => i.courseId === "c1" && i.courseName === "数据结构与算法")).toBe(true);
  });

  it("C：snapshot 优先于 current Course name", () => {
    expect(resolveCourseInvestmentName("c1", "旧名快照", { c1: "新名" })).toBe("旧名快照");
  });

  it("D：snapshot 缺失 → current Course fallback", () => {
    expect(resolveCourseInvestmentName("c1", null, { c1: "数据结构" })).toBe("数据结构");
  });

  it("E：course 不存在（snapshot 与 current 均无）→ 已删除课程", () => {
    expect(resolveCourseInvestmentName("gone", null, {})).toBe("已删除课程");
    expect(resolveCourseInvestmentName(null, null, {})).toBe("未关联课程");
  });

  it("F：Top5 + Other（第 6 项之后聚合；≤5 无 Other；未关联按普通课程排序）", () => {
    const rows = Array.from({ length: 7 }, (_, i) =>
      mkInvestment({ courseId: `c${i + 1}`, courseName: `课程${i + 1}`, minutes: 100 - i * 10, sessions: 1, share: (100 - i * 10) / 490 })
    );
    const view = presentCourseInvestment(rows, {});
    expect(view).toHaveLength(6);
    expect(view[5].courseName).toBe("其他");
    expect(view[5].isOther).toBe(true);
    expect(view[5].minutes).toBe(90); // c6(50) + c7(40)
    expect(view.slice(0, 5).every((v) => v.courseName !== "其他")).toBe(true);
    // ≤5 无 Other
    const small = presentCourseInvestment(rows.slice(0, 5), {});
    expect(small).toHaveLength(5);
    expect(small.some((v) => v.isOther)).toBe(false);
  });
});

describe("Metric reliability presentation（Unknown ≠ Zero）", () => {
  it("G：partial + zero → —", () => {
    expect(presentFocusMetric(0, "partial")).toMatchObject({ value: "—", detail: "该区间记录不完整" });
    expect(presentCompletedMetric(0, "partial")).toMatchObject({ value: "—" });
    expect(presentPlanMetric(0, "partial")).toMatchObject({ value: "—" });
  });

  it("H：partial + positive → 已记录 copy（不假装完整总数）", () => {
    expect(presentFocusMetric(45, "partial")).toMatchObject({ value: "45 分钟" });
    expect(presentFocusMetric(45, "partial").detail).toContain("已记录");
    expect(presentCompletedMetric(3, "partial")).toMatchObject({ value: "已记录 3 项" });
    expect(presentPlanMetric(60, "partial")).toMatchObject({ value: "已记录 1 小时" });
  });

  it("complete + 0 → 0（真实 0，不是 unknown）", () => {
    expect(presentFocusMetric(0, "complete")).toMatchObject({ value: "0 分钟" });
    expect(presentCompletedMetric(0, "complete")).toMatchObject({ value: "0 项" });
  });

  it("I：Plan partial → ratio unavailable（不显示伪精确 %）", () => {
    const v = presentPlanExecutionMetric(120, 150, "partial");
    expect(v.value).toBe("—");
    expect(v.detail).toContain("计划记录不完整");
    // complete + planned=0 → — 且 detail 说明无计划（不是 0%）
    const noPlan = presentPlanExecutionMetric(0, 0, "complete");
    expect(noPlan.value).toBe("—");
    expect(noPlan.detail).toContain("暂无");
    // complete + planned>0 → % + 实际/计划
    const ok = presentPlanExecutionMetric(123, 150, "complete");
    expect(ok.value).toBe("82%");
    expect(ok.detail).toContain("实际 2 小时 3 分 / 计划 2 小时 30 分");
  });

  it("J：OnTime partial → unavailable（不显示看似精确的 rate）", () => {
    expect(presentOnTimeMetric(75, 3, 4, "partial")).toMatchObject({ value: "—", reliability: "partial" });
    expect(presentOnTimeMetric(null, 0, 0, "complete")).toMatchObject({ value: "—", reliability: "unavailable" });
    expect(presentOnTimeMetric(75, 3, 4, "complete")).toMatchObject({ value: "75%", reliability: "complete" });
  });
});

describe("Continuous trend buckets", () => {
  it("K：week → 周一 → 周日 连续 7 天（无事件日仍存在）", () => {
    const buckets = generateTrendBuckets(weekPeriod());
    expect(buckets).toHaveLength(7);
    expect(buckets[0].key).toBe("2026-08-17");
    expect(buckets[6].key).toBe("2026-08-23");
    for (let i = 1; i < buckets.length; i += 1) {
      expect(buckets[i].from - buckets[i - 1].from).toBe(DAY);
    }
  });

  it("L：零活动日 coverage complete → 0（不是 null）", () => {
    const points = buildTrendPoints({
      period: weekPeriod(),
      focusByKey: new Map([["2026-08-17", 60]]),
      planByKey: new Map(),
      completedByKey: new Map(),
      focusCoverageFrom: new Date(2026, 7, 1).getTime(),
      planCoverageFrom: new Date(2026, 7, 1).getTime(),
    });
    const d20 = points.find((p) => p.key === "2026-08-20")!;
    expect(d20.focusMinutes).toBe(0);
    expect(d20.plannedMinutes).toBe(0);
    expect(d20.completedAssignments).toBe(0);
  });

  it("M：coverage 起点之前的 bucket → null（禁止补 0）", () => {
    const planStart = new Date(2026, 7, 19, 0, 0, 0).getTime(); // 周三起计划可靠
    const points = buildTrendPoints({
      period: weekPeriod(),
      focusByKey: new Map(),
      planByKey: new Map([["2026-08-19", 30]]),
      completedByKey: new Map(),
      focusCoverageFrom: new Date(2026, 7, 1).getTime(),
      planCoverageFrom: planStart,
    });
    expect(points.find((p) => p.key === "2026-08-17")!.plannedMinutes).toBeNull();
    expect(points.find((p) => p.key === "2026-08-18")!.plannedMinutes).toBeNull();
    expect(points.find((p) => p.key === "2026-08-19")!.plannedMinutes).toBe(30);
    expect(points.find((p) => p.key === "2026-08-20")!.plannedMinutes).toBe(0);
    // focus 全程 complete → 数字
    expect(points.every((p) => p.focusMinutes === 0)).toBe(true);
  });

  it("N：4weeks 缺失周 → bucket 仍存在（连续，无 gap）", () => {
    const period = fourWeekPeriod();
    const buckets = generateTrendBuckets(period);
    expect(buckets.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < buckets.length; i += 1) {
      expect(buckets[i].from - buckets[i - 1].from).toBe(7 * DAY);
    }
    // 中间周无事件 → 值为 0（coverage complete），bucket 不消失
    const points = buildTrendPoints({
      period,
      focusByKey: new Map([[buckets[0].key, 120]]),
      planByKey: new Map(),
      completedByKey: new Map(),
      focusCoverageFrom: 0,
      planCoverageFrom: 0,
    });
    expect(points).toHaveLength(buckets.length);
    expect(points[1].focusMinutes).toBe(0);
  });

  it("O：semester → 第1周 → 当前教学周，连续；不生成未来周", () => {
    const period = semesterPeriod();
    const buckets = generateTrendBuckets(period);
    expect(buckets[0].key).toBe("w1");
    expect(buckets.map((b) => b.key)).toEqual(Array.from({ length: buckets.length }, (_, i) => `w${i + 1}`));
    expect(buckets[buckets.length - 1].to).toBe(NOW);
    // 周次 = 3（08-03 → 08-23 = 21 天 + 1 = 第 3 周）
    expect(buckets).toHaveLength(3);
  });
});

describe("Trend labels", () => {
  it("week → M/d + 星期；4weeks → M/d；semester → 第N周（无 raw ISO）", () => {
    expect(formatTrendBucketLabel(weekPeriod(), "2026-08-17")).toBe("8/17 周一");
    expect(formatTrendBucketLabel(weekPeriod(), "2026-08-23")).toBe("8/23 周日");
    expect(formatTrendBucketLabel(fourWeekPeriod(), "2026-08-10")).toBe("8/10");
    expect(formatTrendBucketLabel(semesterPeriod(), "w3")).toBe("第3周");
    // tooltip 保留完整日期/范围（V3.1）
    expect(formatTrendTooltip(weekPeriod(), "2026-08-17")).toBe("8月17日 周一");
    expect(formatTrendTooltip(fourWeekPeriod(), "2026-08-10")).toBe("8月10日–8月16日");
    expect(formatTrendTooltip(semesterPeriod(), "w3")).toBe("第3周 · 8月17日–8月23日");
  });
});

describe("Chinese duration formatter", () => {
  it("P：full / compact 全中文，无 h/m", () => {
    expect(formatAnalyticsDuration(0)).toBe("0 分钟");
    expect(formatAnalyticsDuration(45)).toBe("45 分钟");
    expect(formatAnalyticsDuration(60)).toBe("1 小时");
    expect(formatAnalyticsDuration(88)).toBe("1 小时 28 分");
    expect(formatAnalyticsDuration(240)).toBe("4 小时");
    expect(formatAnalyticsDuration(45, "compact")).toBe("45分");
    expect(formatAnalyticsDuration(88, "compact")).toBe("1时28分");
    expect(formatAnalyticsDuration(60, "compact")).toBe("1时");
    expect(formatAnalyticsDuration(0, "compact")).toBe("0分");
    for (const s of [formatAnalyticsDuration(88), formatAnalyticsDuration(88, "compact")]) {
      expect(s).not.toMatch(/[hm]/);
    }
  });
});

describe("Execution Quality reliability（V3.1）", () => {
  const exec = {
    uniqueCompletedAssignments: 3,
    reopenedAssignments: 1,
    onTime: 2,
    late: 1,
    onTimeEligible: 3,
    onTimeRate: 67,
    activeDays: 4,
    avgFocusSessionMinutes: 42,
  };

  it("A：partial assignment → on-time 恒为 —（即使 raw rate 存在）", () => {
    const v = presentExecutionQuality(exec, "partial", "complete");
    expect(v.onTime.value).toBe("—");
    expect(v.onTime.detail).toContain("任务历史不完整");
    expect(v.onTime.reliability).toBe("partial");
  });

  it("B：partial assignment + completed>0 → 已记录 N 项；=0 → —", () => {
    const v = presentExecutionQuality(exec, "partial", "complete");
    expect(v.completed.value).toBe("已记录 3 项");
    expect(v.completed.detail).toContain("不完整");
    expect(v.reopened.value).toBe("已记录 1 项");
    const zero = presentExecutionQuality(
      { ...exec, uniqueCompletedAssignments: 0, reopenedAssignments: 0 },
      "partial",
      "complete"
    );
    expect(zero.completed.value).toBe("—");
    expect(zero.reopened.value).toBe("—");
  });

  it("C：partial focus + activeDays>0 → 已记录 N 天；avg 已记录", () => {
    const v = presentExecutionQuality(exec, "complete", "partial");
    expect(v.activeDays.value).toBe("已记录 4 天");
    expect(v.avgFocusSession.value).toBe("已记录平均 42 分钟/次");
    const zero = presentExecutionQuality(
      { ...exec, activeDays: 0, avgFocusSessionMinutes: null },
      "complete",
      "partial"
    );
    expect(zero.activeDays.value).toBe("—");
    expect(zero.avgFocusSession.value).toBe("—");
  });

  it("D：complete → 正常精确值", () => {
    const v = presentExecutionQuality(exec, "complete", "complete");
    expect(v.completed.value).toBe("3 项");
    expect(v.reopened.value).toBe("1 项");
    expect(v.onTime.value).toBe("67%");
    expect(v.activeDays.value).toBe("4 天");
    expect(v.avgFocusSession.value).toBe("42 分钟/次");
  });
});

describe("Summary divider contract（V3.1）", () => {
  it("F：2×2 时 index 1/3 左分隔、2/3 顶分隔；desktop 除首格外全左分隔", () => {
    const c1 = summaryCellDividerClasses(1);
    expect(c1).toMatch(/(^|\s)border-l(\s|$)/);
    expect(c1).not.toMatch(/(^|\s)border-t(\s|$)/);
    const c2 = summaryCellDividerClasses(2);
    expect(c2).toMatch(/(^|\s)border-t(\s|$)/);
    expect(c2).not.toMatch(/(^|\s)border-l(\s|$)/);
    expect(c2).toContain("lg:border-l");
    expect(c2).toContain("lg:border-t-0");
    const c3 = summaryCellDividerClasses(3);
    expect(c3).toMatch(/(^|\s)border-l(\s|$)/);
    expect(c3).toMatch(/(^|\s)border-t(\s|$)/);
    expect(c3).toContain("lg:border-t-0");
    const c0 = summaryCellDividerClasses(0);
    expect(c0).not.toMatch(/(^|\s)border-l(\s|$)/);
    expect(c0).not.toMatch(/(^|\s)border-t(\s|$)/);
  });
});

describe("Coverage facts（V3.1 progressive disclosure）", () => {
  const base = {
    assignmentReliability: "partial" as const,
    planReliability: "partial" as const,
    focusReliability: "partial" as const,
    focusBackfilled: false,
    historyStartedAt: new Date(2026, 7, 16).getTime(),
    planCoverageStartedAt: new Date(2026, 7, 16).getTime(),
  };

  it("G：有任一不完整 → collapsed summary；全 complete → null", () => {
    expect(buildCoverageSummary(base)).toEqual({
      title: "部分历史记录不完整",
      hint: "部分指标仅展示已记录内容",
    });
    expect(
      buildCoverageSummary({
        ...base,
        assignmentReliability: "complete",
        planReliability: "complete",
        focusReliability: "complete",
        focusBackfilled: false,
      })
    ).toBeNull();
  });

  it("H：展开只显示真实受影响的 metric", () => {
    const lines = buildCoverageFactLines(base);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("任务记录：自 8月16日 起完整");
    expect(lines[1]).toContain("学习计划：自 8月16日 起完整");
    expect(lines[2]).toContain("专注记录");
    // 只有 plan partial → 只有一行
    const onlyPlan = buildCoverageFactLines({
      ...base,
      assignmentReliability: "complete",
      focusReliability: "complete",
    });
    expect(onlyPlan).toHaveLength(1);
    expect(onlyPlan[0]).toContain("学习计划");
  });

  it("I：focus partial 不制造具体起点；backfill 无 partial 时单独说明", () => {
    const lines = buildCoverageFactLines({ ...base, assignmentReliability: "complete", planReliability: "complete" });
    expect(lines).toEqual(["专注记录：当前区间可能不完整"]);
    const backfilled = buildCoverageFactLines({
      ...base,
      assignmentReliability: "complete",
      planReliability: "complete",
      focusReliability: "complete",
      focusBackfilled: true,
    });
    expect(backfilled).toEqual(["已有专注记录仍会正常计入统计"]);
  });
});

describe("Trend tooltip context（V3.1）", () => {
  it("week → 8月17日 周一；4weeks → 周范围；semester → 第N周 + 日期范围", () => {
    expect(formatTrendTooltip(weekPeriod(), "2026-08-17")).toBe("8月17日 周一");
    expect(formatTrendTooltip(fourWeekPeriod(), "2026-08-10")).toBe("8月10日–8月16日");
    expect(formatTrendTooltip(semesterPeriod(), "w3")).toBe("第3周 · 8月17日–8月23日");
  });
});
