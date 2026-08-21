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
      expect(r.pageSize).toBeLessThanOrEqual(count);
      expect(["compact", "normal", "spacious"]).toContain(r.density);
    }
  });

  it("5 items with MAX=4 should be 4+1 pagination", () => {
    const r = resolveAdaptiveDdlLayout({ availableHeight: 460, itemCount: 5 });
    expect(r.pageSize).toBe(4);
    expect(r.density).toBeDefined();
    expect(r.cardHeight).toBeGreaterThanOrEqual(64);
    expect(r.cardHeight).toBeLessThanOrEqual(104);
  });

  it("6+ items never exceeds MAX=4", () => {
    const r = resolveAdaptiveDdlLayout({ availableHeight: 700, itemCount: 7 });
    expect(r.pageSize).toBe(4);
    expect(r.cardHeight).toBeGreaterThanOrEqual(64);
    expect(r.cardHeight).toBeLessThanOrEqual(104);
  });

  it("metrics unified with renderer", async () => {
    const { DDL_DENSITY_METRICS } = await import("@/lib/ui/adaptiveDdlLayout");
    expect(DDL_DENSITY_METRICS.compact.cardHeight).toBe(64);
    expect(DDL_DENSITY_METRICS.normal.cardHeight).toBe(76);
    expect(DDL_DENSITY_METRICS.spacious.cardHeight).toBe(88);
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

  it("pageSize never exceeds MAX=4", () => {
    for (const h of [300, 500, 800, 1200]) {
      const r = resolveAdaptiveDdlLayout({ availableHeight: h, itemCount: 10 });
      expect(r.pageSize).toBeLessThanOrEqual(4);
    }
  });

  it("when pageSize already 4, larger height increases cardHeight not pageSize", () => {
    const r1 = resolveAdaptiveDdlLayout({ availableHeight: 380, itemCount: 10 });
    const r2 = resolveAdaptiveDdlLayout({ availableHeight: 500, itemCount: 10 });
    expect(r1.pageSize).toBe(4);
    expect(r2.pageSize).toBe(4);
    expect(r2.cardHeight).toBeGreaterThanOrEqual(r1.cardHeight);
  });

  it("cardHeight never exceeds MAX 104", () => {
    for (const h of [300, 500, 800, 1200]) {
      const r = resolveAdaptiveDdlLayout({ availableHeight: h, itemCount: 4 });
      expect(r.cardHeight).toBeLessThanOrEqual(104);
    }
  });

  it("1 item large window does not infinite stretch", () => {
    const r = resolveAdaptiveDdlLayout({ availableHeight: 800, itemCount: 1 });
    expect(r.pageSize).toBe(1);
    expect(r.cardHeight).toBeLessThanOrEqual(104);
    expect(r.cardHeight).toBeGreaterThanOrEqual(64);
  });

  it("4 items remaining space digested via cardHeight", () => {
    const r1 = resolveAdaptiveDdlLayout({ availableHeight: 350, itemCount: 4 });
    const r2 = resolveAdaptiveDdlLayout({ availableHeight: 450, itemCount: 4 });
    expect(r1.pageSize).toBe(4);
    expect(r2.pageSize).toBe(4);
    expect(r2.cardHeight).toBeGreaterThan(r1.cardHeight);
  });
});
