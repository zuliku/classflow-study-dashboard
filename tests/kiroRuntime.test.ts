import { describe, it, expect } from "vitest";
import { reuseMessageView } from "@/hooks/useKiroChat";
import {
  allocateVisionPages,
  trimRenderedPagesByBudget,
} from "@/lib/ai/attachments/pdfVision";
import { MAX_SCANNED_PDF_PAGES_PER_TURN } from "@/lib/ai/attachments/limits";

describe("Message View reuse（Task 13）", () => {
  it("必做测试 1：相同 parts/metadata → 复用旧 view；变化的最后一条 → 新建", () => {
    const cache = new Map<string, { partsRef: unknown; metadataRef: unknown; view: object }>();
    const parts1 = [{ type: "text", text: "你好" }];
    const parts2 = [{ type: "text", text: "我在流式" }];
    const meta = { restored: "1" };

    // 第一次：全部新建
    const v1a = reuseMessageView(cache, "m1", parts1, null, () => ({ id: "m1" }));
    const v2a = reuseMessageView(cache, "m2", parts2, null, () => ({ id: "m2" }));
    // 第二次：m1 未变 → 复用；m2 变化（新 parts 引用）→ 新建
    const v1b = reuseMessageView(cache, "m1", parts1, null, () => ({ id: "m1-new" }));
    const v2b = reuseMessageView(cache, "m2", [{ type: "text", text: "我在流式" }], null, () => ({ id: "m2-new" }));
    expect(v1b).toBe(v1a); // view1 === oldView1
    expect(v2a).not.toBe(v2b); // view2 !== oldView2（streaming 变化）
    expect(v2b).toEqual({ id: "m2-new" });

    // metadata 变化也触发重建
    const v1c = reuseMessageView(cache, "m1", parts1, { restored: "2" }, () => ({ id: "m1-meta" }));
    expect(v1c).not.toBe(v1a);
  });
});

describe("Vision 全局页数预算（Task 13 修复）", () => {
  it("必做测试 2：两份扫描 PDF explicit 1–6 + 1–6，总页数仍 ≤ MAX", () => {
    const r = allocateVisionPages(
      [
        { pageCount: 30, explicitPages: [1, 2, 3, 4, 5, 6] },
        { pageCount: 30, explicitPages: [1, 2, 3, 4, 5, 6] },
      ],
      MAX_SCANNED_PDF_PAGES_PER_TURN
    );
    const total = r[0].pages.length + r[1].pages.length;
    expect(total).toBeLessThanOrEqual(MAX_SCANNED_PDF_PAGES_PER_TURN);
    // explicit 优先：两边都尽量拿到指定页（round-robin 公平）
    expect(r[0].pages.length).toBeGreaterThanOrEqual(3);
    expect(r[1].pages.length).toBeGreaterThanOrEqual(3);
  });

  it("explicit 仍优先于默认页", () => {
    const r = allocateVisionPages(
      [
        { pageCount: 30, explicitPages: [12] },
        { pageCount: 30, explicitPages: [] },
      ],
      6
    );
    expect(r[0].pages).toContain(12);
    const total = r[0].pages.length + r[1].pages.length;
    expect(total).toBeLessThanOrEqual(6);
  });
});

describe("Vision 全 Turn 字节预算（Task 13 修复）", () => {
  it("必做测试 3：多份 PDF 渲染合计不超过字节预算", () => {
    const maxBytes = 1000;
    // A 渲染出 3 页（600 字节）→ 剩余 400
    const a = trimRenderedPagesByBudget(
      [
        { page: 1, size: 200 },
        { page: 2, size: 200 },
        { page: 3, size: 200 },
      ],
      maxBytes
    );
    expect(a.map((p) => p.page)).toEqual([1, 2, 3]);
    const remaining = maxBytes - a.reduce((s, p) => s + p.size, 0);
    // B 只有剩余额度（400）：前两页 300 装得下，第三页 200 装不下 → 丢弃
    const b = trimRenderedPagesByBudget(
      [
        { page: 1, size: 100 },
        { page: 2, size: 200 },
        { page: 3, size: 200 },
      ],
      remaining
    );
    expect(b.map((p) => p.page)).toEqual([1, 2]);
    const total = [...a, ...b].reduce((s, p) => s + p.size, 0);
    expect(total).toBeLessThanOrEqual(maxBytes);
  });

  it("单页超过剩余预算 → 丢弃该页（不是部分保留）", () => {
    const r = trimRenderedPagesByBudget(
      [
        { page: 1, size: 300 },
        { page: 2, size: 800 },
        { page: 3, size: 100 },
      ],
      500
    );
    expect(r.map((p) => p.page)).toEqual([1, 3]);
  });
});
