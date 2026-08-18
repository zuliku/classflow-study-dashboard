import { describe, it, expect } from "vitest";
import {
  parseWeekExpression,
  isWeekActive,
  getMaxActiveWeek,
  normalizeWeekExpression,
} from "@/lib/scheduleWeekExpression";

describe("parseWeekExpression", () => {
  it("单段区间 1-16", () => {
    const p = parseWeekExpression("1-16");
    expect(p).not.toBeNull();
    expect(p?.ranges).toEqual([{ start: 1, end: 16 }]);
    expect(p?.parity).toBe("all");
  });

  it("多段逗号 1-5,7-17", () => {
    const p = parseWeekExpression("1-5,7-17");
    expect(p?.ranges).toEqual([
      { start: 1, end: 5 },
      { start: 7, end: 17 },
    ]);
  });

  it("多段 1-4,6-7,9-17", () => {
    const p = parseWeekExpression("1-4,6-7,9-17");
    expect(p?.ranges).toHaveLength(3);
  });

  it("段与单周混排 3-7,9", () => {
    const p = parseWeekExpression("3-7,9");
    expect(p?.ranges).toEqual([{ start: 3, end: 7 }]);
    expect(p?.singles).toEqual([9]);
  });

  it("纯枚举 1,3,5,7", () => {
    const p = parseWeekExpression("1,3,5,7");
    expect(p?.singles).toEqual([1, 3, 5, 7]);
    expect(p?.ranges).toEqual([]);
  });

  it("中文逗号 1-5，7-17", () => {
    const p = parseWeekExpression("1-5，7-17");
    expect(p?.ranges).toHaveLength(2);
  });

  it("单周", () => {
    expect(parseWeekExpression("单周")?.parity).toBe("odd");
  });

  it("双周", () => {
    expect(parseWeekExpression("双周")?.parity).toBe("even");
  });

  it("1-16单周（区间+奇偶）", () => {
    const p = parseWeekExpression("1-16单周");
    expect(p?.ranges).toEqual([{ start: 1, end: 16 }]);
    expect(p?.parity).toBe("odd");
  });

  it("带周后缀 1-16周 / 第1-16周", () => {
    expect(parseWeekExpression("1-16周")?.ranges).toEqual([{ start: 1, end: 16 }]);
    expect(parseWeekExpression("第1-16周")?.ranges).toEqual([{ start: 1, end: 16 }]);
  });

  it("空串 / 无法识别 → null", () => {
    expect(parseWeekExpression("")).toBeNull();
    expect(parseWeekExpression("   ")).toBeNull();
  });
});

describe("isWeekActive", () => {
  it("1-16", () => {
    const p = parseWeekExpression("1-16")!;
    expect(isWeekActive(p, 1)).toBe(true);
    expect(isWeekActive(p, 16)).toBe(true);
    expect(isWeekActive(p, 17)).toBe(false);
  });

  it("1-5,7-17 → 第 6 周 false，第 7 周 true", () => {
    const p = parseWeekExpression("1-5,7-17")!;
    expect(isWeekActive(p, 5)).toBe(true);
    expect(isWeekActive(p, 6)).toBe(false);
    expect(isWeekActive(p, 7)).toBe(true);
    expect(isWeekActive(p, 17)).toBe(true);
    expect(isWeekActive(p, 18)).toBe(false);
  });

  it("1-4,6-7,9-17 → 5/8 周 false", () => {
    const p = parseWeekExpression("1-4,6-7,9-17")!;
    expect(isWeekActive(p, 4)).toBe(true);
    expect(isWeekActive(p, 5)).toBe(false);
    expect(isWeekActive(p, 6)).toBe(true);
    expect(isWeekActive(p, 8)).toBe(false);
    expect(isWeekActive(p, 9)).toBe(true);
  });

  it("3-7,9", () => {
    const p = parseWeekExpression("3-7,9")!;
    expect(isWeekActive(p, 3)).toBe(true);
    expect(isWeekActive(p, 8)).toBe(false);
    expect(isWeekActive(p, 9)).toBe(true);
    expect(isWeekActive(p, 10)).toBe(false);
  });

  it("单周 → 奇数周", () => {
    const p = parseWeekExpression("单周")!;
    expect(isWeekActive(p, 1)).toBe(true);
    expect(isWeekActive(p, 2)).toBe(false);
    expect(isWeekActive(p, 3)).toBe(true);
  });

  it("双周 → 偶数周", () => {
    const p = parseWeekExpression("双周")!;
    expect(isWeekActive(p, 2)).toBe(true);
    expect(isWeekActive(p, 1)).toBe(false);
    expect(isWeekActive(p, 4)).toBe(true);
  });

  it("1-16单周 → 奇数周且在范围内", () => {
    const p = parseWeekExpression("1-16单周")!;
    expect(isWeekActive(p, 1)).toBe(true);
    expect(isWeekActive(p, 2)).toBe(false);
    expect(isWeekActive(p, 15)).toBe(true);
    expect(isWeekActive(p, 17)).toBe(false);
  });

  it("1,3,5,7 枚举", () => {
    const p = parseWeekExpression("1,3,5,7")!;
    expect(isWeekActive(p, 3)).toBe(true);
    expect(isWeekActive(p, 4)).toBe(false);
  });

  it("null（无法解析）→ 默认 true（与旧行为兼容）", () => {
    expect(isWeekActive(null, 5)).toBe(true);
  });
});

describe("getMaxActiveWeek", () => {
  it("1-5,7-17 → 17", () => {
    expect(getMaxActiveWeek(parseWeekExpression("1-5,7-17"))).toBe(17);
  });

  it("3-7,9 → 9", () => {
    expect(getMaxActiveWeek(parseWeekExpression("3-7,9"))).toBe(9);
  });

  it("1,3,5 → 5", () => {
    expect(getMaxActiveWeek(parseWeekExpression("1,3,5"))).toBe(5);
  });

  it("null → fallback 16", () => {
    expect(getMaxActiveWeek(null)).toBe(16);
  });
});

describe("normalizeWeekExpression", () => {
  it("英文逗号归一 1-5,7-17", () => {
    expect(normalizeWeekExpression("1-5,7-17")).toBe("1-5,7-17");
  });

  it("中文逗号归一", () => {
    expect(normalizeWeekExpression("1-5，7-17")).toBe("1-5,7-17");
  });

  it("无法解析返回原串", () => {
    expect(normalizeWeekExpression("随便")).toBe("随便");
  });
});
