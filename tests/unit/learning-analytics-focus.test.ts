import { describe, it, expect } from "vitest";
import { extractFocusFacts, aggregateFocusAnalytics, focusTimeOfDay } from "@/lib/analytics/focusAnalytics";
import { AnalyticsProjectionEvent } from "@/lib/analytics/types";

function focusEv(
  entityId: string,
  startedAt: number,
  actualActiveMs: number,
  courseId?: string,
  courseNameSnapshot?: string
): AnalyticsProjectionEvent {
  return {
    type: "focus.completed",
    entityId,
    occurredAt: startedAt,
    sequence: 1,
    courseId,
    courseNameSnapshot,
    data: { actualActiveMs, startedAt, plannedMinutes: Math.round(actualActiveMs / 60000) },
  };
}

// 2026-08-17 周一，本地时间各时段
const MORNING = new Date(2026, 7, 17, 9, 0, 0).getTime();
const AFTERNOON = new Date(2026, 7, 17, 14, 0, 0).getTime();
const EVENING = new Date(2026, 7, 17, 20, 0, 0).getTime();
const NEXT_DAY_MORNING = new Date(2026, 7, 18, 9, 0, 0).getTime();

describe("Focus Analytics", () => {
  it("focusTimeOfDay 时段划分", () => {
    expect(focusTimeOfDay(3)).toBe("深夜");
    expect(focusTimeOfDay(9)).toBe("上午");
    expect(focusTimeOfDay(14)).toBe("下午");
    expect(focusTimeOfDay(21)).toBe("晚间");
  });

  it("extractFocusFacts：只取 focus.completed，缺失字段跳过", () => {
    const facts = extractFocusFacts([
      focusEv("f1", MORNING, 1_800_000, "c1", "数据结构与算法"),
      { type: "focus.completed", entityId: "f2", occurredAt: MORNING, sequence: 2, data: {} } as AnalyticsProjectionEvent,
      { type: "assignment.completed", entityId: "a1", occurredAt: MORNING, sequence: 3, data: {} } as AnalyticsProjectionEvent,
    ]);
    expect(facts).toHaveLength(1);
    expect(facts[0].courseId).toBe("c1");
    expect(facts[0].courseNameSnapshot).toBe("数据结构与算法");
  });

  it("aggregate：按 startedAt 本地日期归因（跨午夜不拆分）", () => {
    const result = aggregateFocusAnalytics(
      extractFocusFacts([
        focusEv("f1", MORNING, 30 * 60000),
        focusEv("f2", AFTERNOON, 60 * 60000),
        focusEv("f3", NEXT_DAY_MORNING, 45 * 60000),
      ])
    );
    expect(result.totalFocusMinutes).toBe(135);
    expect(result.activeDays).toBe(2);
    expect(result.averageSessionMinutes).toBe(45);
    expect(result.longestSessionMinutes).toBe(60);
    expect(result.points).toHaveLength(2);
    expect(result.points[0].focusMinutes).toBe(90);
    expect(result.points[1].focusMinutes).toBe(45);
  });

  it("aggregate：时段分布与主导时段（样本阈值 5 sessions / 120min）", () => {
    const events: AnalyticsProjectionEvent[] = [];
    for (let i = 0; i < 6; i++) {
      events.push(focusEv(`f${i}`, MORNING + i * 60000, 25 * 60000, "c1"));
    }
    const result = aggregateFocusAnalytics(extractFocusFacts(events));
    expect(result.totalFocusMinutes).toBe(150);
    const morning = result.byTimeOfDay.find((b) => b.bucket === "上午")!;
    expect(morning.sessions).toBe(6);
    expect(morning.minutes).toBe(150);
    expect(result.dominantTimeOfDay).toBe("上午");
  });

  it("aggregate：样本不足 → dominantTimeOfDay null", () => {
    const result = aggregateFocusAnalytics(
      extractFocusFacts([focusEv("f1", MORNING, 30 * 60000), focusEv("f2", EVENING, 30 * 60000)])
    );
    expect(result.dominantTimeOfDay).toBeNull();
  });

  it("aggregate：空输入 → 零值且不抛错", () => {
    const result = aggregateFocusAnalytics([]);
    expect(result.totalFocusMinutes).toBe(0);
    expect(result.activeDays).toBe(0);
    expect(result.averageSessionMinutes).toBeNull();
    expect(result.dominantTimeOfDay).toBeNull();
  });
});
