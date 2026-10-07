import { describe, it, expect } from "vitest";
import { buildAnalyticsVerdict } from "@/lib/analytics/verdict";
import type { LearningSignal } from "@/lib/analytics/types";

const overview = (over: Record<string, unknown> = {}) => ({
  focusDeltaPercent: null,
  completedAssignments: 0,
  onTimeRate: null,
  ...over,
});

const signal = (over: Record<string, unknown> = {}): LearningSignal => ({
  id: "s1",
  tone: "neutral",
  title: "标题",
  description: "描述",
  ...over,
});

describe("buildAnalyticsVerdict", () => {
  it("attention 优先：风险先行 + 信号自带行动", () => {
    const v = buildAnalyticsVerdict({
      signals: [
        signal({ id: "a", tone: "positive", title: "专注投入增加" }),
        signal({
          id: "b",
          tone: "attention",
          title: "截止节奏",
          description: "有 1 项临近逾期",
          action: { label: "去排期", targetTab: "assignments" },
        }),
      ],
      overview: overview({ focusDeltaPercent: 25, completedAssignments: 3 }),
      comparisonAvailable: true,
    });
    expect(v.tone).toBe("warn");
    expect(v.headline).toBe("截止节奏");
    expect(v.detail).toContain("有 1 项临近逾期");
    expect(v.detail).toContain("↑ 25%");
    expect(v.actionLabel).toBe("去排期");
    expect(v.actionTab).toBe("assignments");
  });

  it("positive：给稳健判断 + 完成数", () => {
    const v = buildAnalyticsVerdict({
      signals: [signal({ id: "a", tone: "positive", title: "专注投入增加", description: "专注增加了" })],
      overview: overview({ focusDeltaPercent: 25, completedAssignments: 3 }),
      comparisonAvailable: true,
    });
    expect(v.tone).toBe("good");
    expect(v.headline).toBe("本周节奏稳健");
    expect(v.detail).toContain("完成 3 项");
    expect(v.actionLabel).toBe("查看任务");
  });

  it("无 comparison 时不编造 delta；无信号给积累中", () => {
    const v = buildAnalyticsVerdict({
      signals: [signal({ tone: "neutral", title: "投入集中", description: "集中在数学" })],
      overview: overview({ focusDeltaPercent: 99 }),
      comparisonAvailable: false,
    });
    expect(v.tone).toBe("flat");
    expect(v.detail).not.toContain("99");
    const empty = buildAnalyticsVerdict({
      signals: [],
      overview: overview(),
      comparisonAvailable: false,
    });
    expect(empty.headline).toBe("数据积累中");
    expect(empty.actionTab).toBe("assignments");
  });
});
