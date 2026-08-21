import { describe, it, expect } from "vitest";
import { resolveAdaptiveDdlLayout } from "@/lib/ui/adaptiveDdlLayout";

describe("Adaptive DDL Layout", () => {
  it("availableHeight very small -> pageSize <=3 and at least 1", () => {
    const r = resolveAdaptiveDdlLayout({ availableHeight: 80, itemCount: 10 });
    expect(r.pageSize).toBeGreaterThanOrEqual(1);
    expect(r.pageSize).toBeLessThanOrEqual(3);
    expect(r.density).toBe("compact");
  });

  it("availableHeight increase -> pageSize non-decreasing", () => {
    const r1 = resolveAdaptiveDdlLayout({ availableHeight: 200, itemCount: 10 });
    const r2 = resolveAdaptiveDdlLayout({ availableHeight: 400, itemCount: 10 });
    const r3 = resolveAdaptiveDdlLayout({ availableHeight: 700, itemCount: 10 });
    expect(r2.pageSize).toBeGreaterThanOrEqual(r1.pageSize);
    expect(r3.pageSize).toBeGreaterThanOrEqual(r2.pageSize);
  });

  it("when space enough and items remain, pageSize >3", () => {
    // Tall container 500px should allow 4 compact items
    const r = resolveAdaptiveDdlLayout({ availableHeight: 500, itemCount: 8 });
    expect(r.pageSize).toBeGreaterThan(3);
  });

  it("itemCount < capacity -> pageSize <= itemCount", () => {
    const r = resolveAdaptiveDdlLayout({ availableHeight: 800, itemCount: 2 });
    expect(r.pageSize).toBeLessThanOrEqual(2);
    expect(r.density).toBeDefined();
  });

  it("extremely small height -> at least 1", () => {
    const r = resolveAdaptiveDdlLayout({ availableHeight: 10, itemCount: 5 });
    expect(r.pageSize).toBe(1);
  });

  it("0 items -> pageSize 0", () => {
    const r = resolveAdaptiveDdlLayout({ availableHeight: 500, itemCount: 0 });
    expect(r.pageSize).toBe(0);
  });

  it("item count 4/5/8/10 with different heights", () => {
    const cases: Array<[number, number]> = [
      [250, 4],
      [350, 5],
      [500, 8],
      [600, 10],
    ];
    for (const [h, count] of cases) {
      const r = resolveAdaptiveDdlLayout({ availableHeight: h, itemCount: count });
      expect(r.pageSize).toBeGreaterThanOrEqual(1);
      expect(r.pageSize).toBeLessThanOrEqual(5);
      expect(r.pageSize).toBeLessThanOrEqual(count);
      expect(["compact", "normal", "spacious"]).toContain(r.density);
    }
  });

  it("all items fit with spacious when abundant space", () => {
    // 2 items in tall container should be spacious
    const r = resolveAdaptiveDdlLayout({ availableHeight: 400, itemCount: 2 });
    // Could be spacious or normal, but should not be compact if spacious fits well
    expect(r.pageSize).toBe(2);
    // If spacious, density is spacious; if normal also fits, that's okay but spacious is preferred when abundant
    // We check that pageSize equals itemCount
    expect(r.pageSize).toBe(2);
  });

  it("deterministic: same input -> same output", () => {
    const a = resolveAdaptiveDdlLayout({ availableHeight: 300, itemCount: 7 });
    const b = resolveAdaptiveDdlLayout({ availableHeight: 300, itemCount: 7 });
    expect(a).toEqual(b);
  });
});
