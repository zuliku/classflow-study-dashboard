import { describe, it, expect } from "vitest";
import { paginate, clampPage } from "@/lib/pagination";

const items = (n: number) => Array.from({ length: n }, (_, i) => `item-${i + 1}`);

describe("paginate", () => {
  it("0 items → 空页，totalPages 1", () => {
    const r = paginate(items(0), 1, 5);
    expect(r.items).toEqual([]);
    expect(r.totalItems).toBe(0);
    expect(r.totalPages).toBe(1);
    expect(r.currentPage).toBe(1);
  });

  it("1 item → 单页", () => {
    const r = paginate(items(1), 1, 5);
    expect(r.items).toEqual(["item-1"]);
    expect(r.totalPages).toBe(1);
  });

  it("5 items → 单页 5 条", () => {
    const r = paginate(items(5), 1, 5);
    expect(r.items).toHaveLength(5);
    expect(r.totalPages).toBe(1);
  });

  it("6 items → 第 1 页 5 条 / 第 2 页 1 条", () => {
    const p1 = paginate(items(6), 1, 5);
    expect(p1.items).toEqual(["item-1", "item-2", "item-3", "item-4", "item-5"]);
    expect(p1.totalPages).toBe(2);
    const p2 = paginate(items(6), 2, 5);
    expect(p2.items).toEqual(["item-6"]);
    expect(p2.currentPage).toBe(2);
  });

  it("12 items → 3 页，页内容正确", () => {
    const p1 = paginate(items(12), 1, 5);
    expect(p1.totalPages).toBe(3);
    expect(p1.items).toHaveLength(5);
    const p3 = paginate(items(12), 3, 5);
    expect(p3.items).toEqual(["item-11", "item-12"]);
  });

  it("UpcomingDDL 场景（pageSize=3）：3/4/7 items 页数正确", () => {
    expect(paginate(items(3), 1, 3).totalPages).toBe(1);
    const p4 = paginate(items(4), 1, 3);
    expect(p4.totalPages).toBe(2);
    expect(p4.items).toHaveLength(3);
    expect(paginate(items(4), 2, 3).items).toEqual(["item-4"]);
    const p7 = paginate(items(7), 1, 3);
    expect(p7.totalPages).toBe(3);
    expect(paginate(items(7), 2, 3).items).toEqual(["item-4", "item-5", "item-6"]);
    expect(paginate(items(7), 3, 3).items).toEqual(["item-7"]);
  });

  it("page clamp：超出总页数回到最后一页，绝不出现 第 2 / 1 页", () => {
    const r = paginate(items(6), 5, 5); // 只有 2 页，请求第 5 页
    expect(r.currentPage).toBe(2);
    expect(r.items).toEqual(["item-6"]);
  });

  it("不修改原数组", () => {
    const src = items(7);
    paginate(src, 2, 5);
    expect(src).toHaveLength(7);
  });
});

describe("clampPage", () => {
  it("基本 clamp", () => {
    expect(clampPage(0, 3)).toBe(1);
    expect(clampPage(1, 3)).toBe(1);
    expect(clampPage(2, 3)).toBe(2);
    expect(clampPage(9, 3)).toBe(3);
  });
});
