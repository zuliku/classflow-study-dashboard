import { describe, it, expect } from "vitest";
import {
  buildStudyMomentum,
  momentumLevel,
  momentumDateRange,
  MOMENTUM_DAYS,
} from "@/lib/analytics/momentum";

const focus = (localDate: string, minutes: number) => ({
  type: "focus.completed",
  localDate,
  data: { actualActiveMs: minutes * 60000 },
});
const done = (localDate: string) => ({ type: "assignment.completed", localDate, data: {} });

describe("momentumLevel", () => {
  it("阈值：0 / <30 / <60 / <120 / ≥120", () => {
    expect(momentumLevel(0)).toBe(0);
    expect(momentumLevel(29.9)).toBe(1);
    expect(momentumLevel(30)).toBe(2);
    expect(momentumLevel(119.9)).toBe(3);
    expect(momentumLevel(120)).toBe(4);
  });
});

describe("buildStudyMomentum", () => {
  it("默认 84 天；分钟聚合 + 完成计数", () => {
    const m = buildStudyMomentum({
      events: [focus("2026-10-05", 25), focus("2026-10-05", 35), done("2026-10-06")],
      todayStr: "2026-10-09",
      historyStartedAt: null,
    });
    expect(m.days).toHaveLength(MOMENTUM_DAYS);
    expect(m.days[m.days.length - 1].date).toBe("2026-10-09");
    const mon = m.days.find((d) => d.date === "2026-10-05")!;
    expect(mon.minutes).toBe(60);
    expect(mon.level).toBe(3);
    const tue = m.days.find((d) => d.date === "2026-10-06")!;
    expect(tue.completed).toBe(1);
    expect(tue.active).toBe(true);
    expect(tue.level).toBe(1);
    expect(m.totalMinutes).toBe(60);
  });

  it("连续：今天动则含今天；今天没动昨天动则保持；两天都没动则 0；未来不参与", () => {
    const base = {
      todayStr: "2026-10-09",
      historyStartedAt: null,
    };
    // 今天动：Mon–Fri 全动 → 5（Sat/Sun 无事件不影响，往回数遇非活跃即停…此处 data 跨天需显式给出）
    const events = [
      focus("2026-10-05", 10),
      focus("2026-10-06", 10),
      focus("2026-10-07", 10),
      focus("2026-10-08", 10),
      focus("2026-10-09", 10),
    ];
    expect(buildStudyMomentum({ ...base, events }).streakDays).toBe(5);
    expect(buildStudyMomentum({ ...base, events }).activeToday).toBe(true);
    // 今天没动、昨天动 → 4（保持中）
    const noToday = events.slice(0, 4);
    const kept = buildStudyMomentum({ ...base, events: noToday });
    expect(kept.streakDays).toBe(4);
    expect(kept.activeToday).toBe(false);
    // 两天没动 → 0
    expect(buildStudyMomentum({ ...base, events: noToday.slice(0, 3) }).streakDays).toBe(0);
  });

  it("未知日（记录起点之前）灰色且打断连续", () => {
    const m = buildStudyMomentum({
      events: [focus("2026-10-05", 60), focus("2026-10-09", 60)],
      todayStr: "2026-10-09",
      historyStartedAt: new Date("2026-10-08T00:00:00").getTime(),
    });
    const mon = m.days.find((d) => d.date === "2026-10-05")!;
    expect(mon.unknown).toBe(true);
    expect(mon.active).toBe(false);
    expect(mon.minutes).toBe(0);
    // 周一未知 → 即使周五动，连续也被打断为 1
    expect(m.streakDays).toBe(1);
  });

  it("非法分钟（负数/NaN/非数字）不计入", () => {
    const m = buildStudyMomentum({
      events: [
        { type: "focus.completed", localDate: "2026-10-09", data: { actualActiveMs: -5 } },
        { type: "focus.completed", localDate: "2026-10-09", data: { actualActiveMs: Number.NaN } },
        { type: "focus.completed", localDate: "2026-10-09", data: {} },
      ],
      todayStr: "2026-10-09",
      historyStartedAt: null,
    });
    expect(m.days.find((d) => d.date === "2026-10-09")!.minutes).toBe(0);
    expect(m.streakDays).toBe(0);
  });

  it("momentumDateRange 升序、定长、以今天结尾", () => {
    const dates = momentumDateRange("2026-10-09", 7);
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe("2026-10-03");
    expect(dates[6]).toBe("2026-10-09");
  });
});
