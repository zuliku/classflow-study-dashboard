import { describe, it, expect } from "vitest";
import { resolveAnalyticsPeriod, mondayOfLocalWeek } from "@/lib/analytics/range";

const SEMESTER = { id: "sem1", name: "测试学期", startDate: "2026-08-03", totalWeeks: 16 };

// 2026-08-17 是周一；用固定本地时间避免时区问题
const MON = new Date(2026, 7, 17, 0, 0, 0).getTime();
const WED_NOON = new Date(2026, 7, 19, 12, 0, 0).getTime();

describe("Analytics Range", () => {
  it("week：current = 本周一 00:00 → now；previous = 上周一 + 同 elapsed", () => {
    const period = resolveAnalyticsPeriod("week", SEMESTER, WED_NOON);
    expect(period.current.from).toBe(MON);
    expect(period.current.to).toBe(WED_NOON);
    expect(period.previous).not.toBeNull();
    expect(period.previous!.from).toBe(MON - 7 * 86400000);
    expect(period.previous!.to).toBe(period.previous!.from + (WED_NOON - MON));
    expect(period.trendGrain).toBe("day");
  });

  it("4weeks：current = 最近 28d；previous = 之前 28d", () => {
    const period = resolveAnalyticsPeriod("4weeks", SEMESTER, WED_NOON);
    expect(period.current.to).toBe(WED_NOON);
    expect(period.current.from).toBe(WED_NOON - 28 * 86400000);
    expect(period.previous!.from).toBe(WED_NOON - 56 * 86400000);
    expect(period.previous!.to).toBe(period.current.from);
    expect(period.trendGrain).toBe("week");
  });

  it("semester：current = startDate → min(now, end)；previous = null", () => {
    const period = resolveAnalyticsPeriod("semester", SEMESTER, WED_NOON);
    expect(period.current.from).toBe(new Date(2026, 7, 3).getTime());
    expect(period.current.to).toBe(WED_NOON);
    expect(period.previous).toBeNull();
    expect(period.trendGrain).toBe("semester-week");
  });

  it("semester：now 超过学期结束 → to 截断到结束日", () => {
    const later = new Date(2026, 11, 15).getTime(); // 12-15，已过 8/3+16w=11/23
    const period = resolveAnalyticsPeriod("semester", SEMESTER, later);
    expect(period.current.to).toBeLessThan(later);
    expect(period.current.to).toBe(new Date(2026, 7, 3).getTime() + 16 * 7 * 86400000);
  });

  it("mondayOfLocalWeek：周日归到本周一", () => {
    const sunday = new Date(2026, 7, 23, 18, 0, 0).getTime(); // 周日
    expect(mondayOfLocalWeek(sunday)).toBe(MON);
  });
});
