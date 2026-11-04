import { describe, it, expect } from "vitest";
import { resolveAnalyticsPeriod } from "@/lib/analytics/range";
import { generateTrendBuckets } from "@/lib/analytics/learningAnalytics";

const SEMESTER = { id: "sem1", name: "测试学期", startDate: "2026-08-03", totalWeeks: 16 };

/**
 * DST 回归（独立文件：process.env.TZ 运行时切换会影响同进程内 Date 缓存，
 * 不能与其它时区断言混跑）。
 */
describe("Analytics Range · DST", () => {
  it("跨夏令时后仍按本地日历周/日计算（America/New_York）", () => {
    const hadTZ = Object.prototype.hasOwnProperty.call(process.env, "TZ");
    const previousTZ = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      // 2026-03-08 进入 EDT；3/9 周一 00:00 EDT，3/2 周一 00:00 EST 只差 167h
      const now = new Date(2026, 2, 11, 12).getTime();
      const week = resolveAnalyticsPeriod("week", SEMESTER, now);
      expect(new Date(week.current.from).getDate()).toBe(9);
      expect(new Date(week.current.from).getHours()).toBe(0);
      expect(new Date(week.previous!.from).getDate()).toBe(2);
      expect(new Date(week.previous!.from).getHours()).toBe(0);

      const four = resolveAnalyticsPeriod("4weeks", SEMESTER, now);
      expect(new Date(four.current.from).getHours()).toBe(12);
      expect(new Date(four.previous!.from).getHours()).toBe(12);

      // 跨 DST 当周的日 bucket：最后一天从本地 00:00 开始（不是 01:00）
      const springWeek = resolveAnalyticsPeriod("week", SEMESTER, new Date(2026, 2, 8, 12).getTime());
      const dayBuckets = generateTrendBuckets(springWeek);
      expect(dayBuckets.map((b) => b.key)).toEqual([
        "2026-03-02",
        "2026-03-03",
        "2026-03-04",
        "2026-03-05",
        "2026-03-06",
        "2026-03-07",
        "2026-03-08",
      ]);
      expect(new Date(dayBuckets[6].from).getHours()).toBe(0);

      // 4 周趋势的周 bucket 必须始终锚定本地周一 00:00
      const fourBuckets = generateTrendBuckets(
        resolveAnalyticsPeriod("4weeks", SEMESTER, new Date(2026, 3, 1, 12).getTime())
      );
      expect(fourBuckets.length).toBeGreaterThan(0);
      expect(fourBuckets.every((b) => new Date(b.from).getHours() === 0)).toBe(true);
    } finally {
      if (hadTZ) process.env.TZ = previousTZ;
      else delete process.env.TZ;
    }
  });
});
