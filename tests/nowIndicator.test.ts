import { describe, it, expect } from "vitest";
import { getNowIndicatorPosition, NOW_INDICATOR_SAFE_INSET_PX } from "@/lib/timeline/nowIndicator";

const DAY_START = 8 * 60; // 08:00
const TOTAL = 780; // 08:00 → 21:00
const TIMELINE_END = DAY_START + TOTAL; // 21:00

const pct = (now: number) => `${((now - DAY_START) / TOTAL) * 100}%`;

describe("getNowIndicatorPosition（21:00 后固定 Hotfix）", () => {
  it("Test 1：20:30 → 正常时间比例位置，非 pinned", () => {
    const r = getNowIndicatorPosition({ nowMinutes: 20 * 60 + 30, dayStartMinutes: DAY_START, totalMinutes: TOTAL });
    expect(r.position).toBe("timeline");
    expect(r.top).toBe(pct(20 * 60 + 30));
  });

  it("Test 2：21:00 → 仍走正常 timeline position（>= 才 pinned，21:00 本身是时间轴终点）", () => {
    const r = getNowIndicatorPosition({ nowMinutes: TIMELINE_END, dayStartMinutes: DAY_START, totalMinutes: TOTAL });
    expect(r.position).toBe("timeline");
    expect(r.top).toBe("100%");
  });

  it("Test 3：21:01 → pinned 到底部安全位", () => {
    const r = getNowIndicatorPosition({ nowMinutes: TIMELINE_END + 1, dayStartMinutes: DAY_START, totalMinutes: TOTAL });
    expect(r.position).toBe("pinned");
    expect(r.top).toBe(`calc(100% - ${NOW_INDICATOR_SAFE_INSET_PX}px)`);
  });

  it("Test 4：23:45 → 与 21:01 完全相同的 pinned 位置（不再随时间变化）", () => {
    const late = getNowIndicatorPosition({ nowMinutes: 23 * 60 + 45, dayStartMinutes: DAY_START, totalMinutes: TOTAL });
    const justAfter = getNowIndicatorPosition({ nowMinutes: TIMELINE_END + 1, dayStartMinutes: DAY_START, totalMinutes: TOTAL });
    expect(late.top).toBe(justAfter.top);
    expect(late.position).toBe("pinned");
  });

  it("Test 5：nowMinutes 真实时间不被 clamp（21:00 后仍传真实值，position 只是视觉层）", () => {
    const r = getNowIndicatorPosition({ nowMinutes: 23 * 60 + 45, dayStartMinutes: DAY_START, totalMinutes: TOTAL });
    // 函数不修改输入；调用方继续用真实 nowMinutes 渲染胶囊文字
    expect(r.top).not.toBe("100%");
    expect(r.top).not.toBe(`${((TIMELINE_END - DAY_START) / TOTAL) * 100}%`);
  });

  it("边界：20:59 → timeline；21:00 → timeline；21:01 → pinned", () => {
    expect(getNowIndicatorPosition({ nowMinutes: TIMELINE_END - 1, dayStartMinutes: DAY_START, totalMinutes: TOTAL }).position).toBe("timeline");
    expect(getNowIndicatorPosition({ nowMinutes: TIMELINE_END, dayStartMinutes: DAY_START, totalMinutes: TOTAL }).position).toBe("timeline");
    expect(getNowIndicatorPosition({ nowMinutes: TIMELINE_END + 1, dayStartMinutes: DAY_START, totalMinutes: TOTAL }).position).toBe("pinned");
  });

  it("对称保护：早于 08:00 → 固定顶部安全位（top 不为负）", () => {
    const r = getNowIndicatorPosition({ nowMinutes: 7 * 60 + 30, dayStartMinutes: DAY_START, totalMinutes: TOTAL });
    expect(r.position).toBe("pinned");
    expect(r.top).toBe(`calc(0% + ${NOW_INDICATOR_SAFE_INSET_PX}px)`);
  });
});
